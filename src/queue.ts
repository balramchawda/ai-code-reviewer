import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import fs from 'fs';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
// 🚨 इम्पोर्ट का तरीका बदलें (ESM कम्पैटिबिलिटी के लिए सबसे बेस्ट)
import * as pkgOpenAI from 'openai'; 
import { z } from 'zod';

const OpenAI = (pkgOpenAI.default || pkgOpenAI) as any;

dotenv.config();

const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
});

export const prReviewQueue = new Queue('pr-review-queue', { connection: redisConnection });

// 🚨 यहाँ ध्यान दें: 'new OpenAI' सही से होना चाहिए
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const privateKey = fs.readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH || './private-key.pem', 'utf8');

const ReviewCommentSchema = z.object({
  comments: z.array(
    z.object({
      path: z.string().describe("The relative file path, e.g., 'src/index.js'"),
      line: z.number().describe("The exact line number where the issue exists"),
      body: z.string().describe("Constructive feedback with clear explanation. Use Markdown."),
    })
  ),
});

export const prReviewWorker = new Worker(
  'pr-review-queue',
  async (job: Job) => {
    const { repoName, prNumber, installationId } = job.data;
    const [owner, repo] = repoName.split('/');

    console.log(`[📦 Worker Processing] Job ID: ${job.id} for PR #${prNumber} in ${repoName}`);

    try {
      // 🛠️ फिक्स: @octokit/auth-app का उपयोग करके सीधा एक ऑथेंटिकेटेड Octokit इंस्टेंस बनाएं
      const octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: process.env.GITHUB_APP_ID as string,
          privateKey: privateKey,
          installationId: Number(installationId), // यह विशिष्ट क्लाइंट के रिपॉजिटरी के लिए ऑटो-टोकन जनरेट कर देगा
        },
      });

      console.log(`[🔍 Fetching Diff] Downloading diff for PR #${prNumber}...`);
      
      const { data: diffData } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        mediaType: { format: 'diff' }, // गिटहब से रॉ टेक्स्ट डिफ़ मांगेगा
      });

      const gitDiff = diffData as unknown as string;

      if (!gitDiff || gitDiff.trim() === '') {
        console.log(`[⚠️ Skip] PR #${prNumber} में कोई कोड चेंज नहीं मिला।`);
        return;
      }

      console.log(`[🤖 AI Processing] Sending code changes to OpenAI...`);
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: "json_object" }, // यह OpenAI को मजबूर करेगा कि वह सिर्फ JSON ऑब्जेक्ट ही रिटर्न करे
        messages: [
          {
            role: 'system',
            content: `You are an expert Senior Full-Stack Engineer. Review the provided Git Diff. 
            Focus ONLY on modified lines (+). Provide constructive feedback with code blocks if needed.
            
            You MUST respond with a valid JSON object matching this exact schema:
            {
              "comments": [
                {
                  "path": "string (the relative file path)",
                  "line": number (the exact line number where the issue exists)",
                  "body": "string (constructive feedback in markdown style)"
                }
              ]
            }
            
            If everything is good and no bugs are found, return an empty comments array: {"comments": []}`,
          },
          {
            role: 'user',
            content: `Review this Git Diff for PR #${prNumber}:\n\n${gitDiff}`,
          },
        ],
      });

      // OpenAI से आए रॉ स्ट्रिंग को JSON में पार्स करना
      const rawText = completion.choices[0].message.content || '{"comments": []}';
      const aiResponse = JSON.parse(rawText);
      const reviewComments = aiResponse?.comments || [];
      console.log(`[📊 AI Insights] Model found ${reviewComments.length} potential issues.`);

      if (reviewComments.length > 0) {
        console.log(`[📝 Posting Comments] Syncing reviews back to GitHub PR...`);

        await octokit.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          event: 'COMMENT',
          body: '👋 Hello! Here is my automated AI review for your PR:',
          comments: reviewComments.map(c => ({
            path: c.path,
            line: c.line,
            body: c.body
          })),
        });

        console.log(`[✅ Success] Comments successfully posted to PR #${prNumber}!`);
      } else {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: '🎉 **AI Code Reviewer Summary:** The code changes look great! No critical issues found.',
        });
        console.log(`[✅ Success] Positive summary posted to PR #${prNumber}.`);
      }

    } catch (error: any) {
      console.error(`[❌ Worker Error] Job ${job.id} failed:`, error);
      throw error;
    }
  },
  { connection: redisConnection }
);
