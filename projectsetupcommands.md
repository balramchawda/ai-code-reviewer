1. GitHub App सेटअप (GitHub Configuration)सबसे पहले GitHub को बताना होगा कि हमारा एक ऐप है जो कोड को रीड और राइट कर सकता है।अपने GitHub अकाउंट पर जाएं -> Settings -> Developer Settings -> GitHub Apps -> New GitHub App.App Name: कोई भी नाम दें (उदा. Dev-AI-Code-Reviewer).Homepage URL: अभी के लिए अपना पर्सनल गिटहब यूआरएल डाल दें।Webhook URL: इसके लिए आपको एक पब्लिक यूआरएल चाहिए होगा। आप अपने लोकल मशीन पर Ngrok या Localtunnel का उपयोग कर सकते हैं।लोकल टर्मिनल में चलाएं: npx localtunnel --port 3000जो यूआरएल मिले (उदा: https://localtunnel.me), उसे कॉपी करें।गिटहब में Webhook URL में डालें: https://localtunnel.meWebhook Secret: एक मजबूत पासवर्ड रखें (उदा: super_secret_webhook_key_123). इसे संभाल कर रखें।Permissions: यह सबसे जरूरी स्टेप है:Repository Permissions -> Pull Requests: इसे Read & Write करें (कमेंट्स पोस्ट करने के लिए)।Repository Permissions -> Contents: इसे Read-Only करें (कोड का diff देखने के लिए)।Repository Permissions -> Metadata: इसे Read-Only रहने दें (बाय डिफ़ॉल्ट होता है)।Subscribe to events: नीचे जाकर Pull request वाले चेकबॉक्स को टिक कर दें।Create GitHub App पर क्लिक करें।ऐप बनने के बाद, नीचे स्क्रॉल करें और Generate a private key पर क्लिक करें। एक .pem फ़ाइल डाउनलोड होगी, इसे अपने प्रोजेक्ट फोल्डर में सेव कर लें। इसके अलावा अपना App ID भी नोट कर लें।

-------------------------------
mkdir ai-code-reviewer && cd ai-code-reviewer
npm init -y
npm install typescript @types/node tsx dotenv express @octokit/webhooks @octokit/auth-app --save
npx tsc --init

PORT=3000
GITHUB_APP_ID=YOUR_APP_ID_HERE
GITHUB_WEBHOOK_SECRET=super_secret_webhook_key_123
GITHUB_PRIVATE_KEY_PATH="./private-key.pem"
REDIS_HOST="127.0.0.1"
REDIS_PORT=6379

---------------------------
GitHub के Webhooks की एक सख्त लिमिट होती है: आपके सर्वर को 10 सेकंड के अंदर 200 OK रिपॉन्स देना ही होगा। अगर हमारा AI मॉडल कोड का रिव्यू करने में 15 या 30 सेकंड लगाता है, तो GitHub कनेक्शन को Timeout मान लेगा और एरर दिखाएगा।इससे बचने के लिए हम Event-Driven Architecture का उपयोग करेंगे:Webhook रिक्वेस्ट आते ही हम डेटा को BullMQ (Redis Queue) में डालेंगे।तुरंत GitHub को 200 OK भेज देंगे (यह काम 50ms में हो जाएगा)।बैकग्राउंड में एक Worker आराम से उस जॉब को उठाएगा, AI प्रोसेसिंग करेगा, और कमेंट पोस्ट करेगा


npm install bullmq ioredis
