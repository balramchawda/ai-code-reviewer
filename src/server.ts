import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { prReviewQueue } from './queue.ts';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET as string;

// 🚨 महत्वपूर्ण: गिटहब सिग्नेचर वेरीफाई करने के लिए हमें RAW BUFFER बॉडी चाहिए होती है।
// इसलिए हम express.json() को इस तरह कॉन्फ़िगर करेंगे:
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

// 🔐 गिटहब सिग्नेचर वेरिफिकेशन फ़ंक्शन
function verifyGitHubSignature(req: any): boolean {
  const signature = req.headers['x-hub-signature-256'] as string;
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(req.rawBody).digest('hex');
  
  // सेफ कम्पेरिजन (Timing attacks से बचने के लिए)
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

// 🚀 आपका एक्सप्लिसिट POST मेथड (अब 404 कभी नहीं आएगी!)
app.post('/webhook', async (req: any, res: any) => {
  console.log('--- 🚀 Incoming POST Request on /webhook ---');

  // 1. सुरक्षा जांच (Security Check)
  if (!verifyGitHubSignature(req)) {
    console.error('[❌ Security Error]: Invalid GitHub Signature');
    return res.status(401).send('Unauthorized: Invalid Signature');
  }

  const githubEvent = req.headers['x-github-event'];
  const payload = req.body;
  console.log(githubEvent,'githubEvent')
  // 2. सिर्फ Pull Request इवेंट्स को प्रोसेस करना
  if (githubEvent === 'pull_request') {
    const action = payload.action; // opened, synchronize, closed आदि
    const repoName = payload.repository?.full_name;
    const prNumber = payload.number;
    const installationId = payload.installation?.id;

    console.log(`[📦 GitHub Event]: PR ${action} received for ${repoName} #${prNumber}`);

    if (action === 'opened' || action === 'synchronize') {
      // बैकग्राउंड क्यू (BullMQ) में पुश करें
      await prReviewQueue.add(`review-${repoName}-${prNumber}`, {
        repoName,
        prNumber,
        installationId,
      });
      console.log(`[✅ Queue]: Job added to BullMQ successfully`);
    }
    
    // गिटहब को तुरंत 200 OK दें (ताकि टाइमआउट न हो)
    return res.status(200).send('Event received and queued.');
  }

  // अगर कोई और इवेंट है (जैसे ping, push आदि) तो सिर्फ 200 OK दे दें
  return res.status(200).send('Event skipped.');
});

app.get('/', (req, res) => {
  res.send('AI Code Reviewer Server is live! 🚀');
});

app.listen(port, () => {
  console.log(`🚀 Custom Webhook Server is running on port ${port}`);
});
