// In-memory storage (will reset on each deployment, but works for demo)
let connections = new Map();
let offers = new Map();

export default function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { method } = req;
  const { action, code, offer, answer } = req.body || {};
  const { action: getAction, code: getCode } = req.query || {};

  try {
    if (method === 'POST') {
      switch (action) {
        case 'store-offer':
          offers.set(code, {
            offer,
            timestamp: Date.now()
          });
          cleanupOldOffers();
          res.json({ success: true, message: 'Offer stored' });
          break;

        case 'get-offer':
          const storedOffer = offers.get(code);
          if (!storedOffer) {
            res.status(404).json({ error: 'Code not found or expired' });
            return;
          }
          res.json({ offer: storedOffer.offer });
          break;

        case 'store-answer':
          connections.set(code, {
            answer,
            timestamp: Date.now()
          });
          res.json({ success: true, message: 'Answer stored' });
          break;

        case 'get-answer':
          const storedAnswer = connections.get(code);
          if (!storedAnswer) {
            res.status(404).json({ error: 'Answer not ready' });
            return;
          }
          // Clean up after retrieving answer
          connections.delete(code);
          offers.delete(code);
          res.json({ answer: storedAnswer.answer });
          break;

        default:
          res.status(400).json({ error: 'Invalid action' });
      }
    } else if (method === 'GET') {
      // Long polling for answers
      if (getAction === 'poll-answer' && getCode) {
        pollForAnswer(getCode, res);
      } else {
        res.status(400).json({ error: 'Invalid request' });
      }
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function pollForAnswer(code, res) {
  const maxAttempts = 30; // 30 seconds max
  let attempts = 0;
  
  const checkAnswer = () => {
    const storedAnswer = connections.get(code);
    if (storedAnswer) {
      connections.delete(code);
      offers.delete(code);
      res.json({ answer: storedAnswer.answer });
    } else if (attempts >= maxAttempts) {
      res.status(408).json({ error: 'Timeout waiting for answer' });
    } else {
      attempts++;
      setTimeout(checkAnswer, 1000);
    }
  };
  
  checkAnswer();
}

function cleanupOldOffers() {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  
  for (const [code, data] of offers.entries()) {
    if (now - data.timestamp > maxAge) {
      offers.delete(code);
    }
  }
  
  for (const [code, data] of connections.entries()) {
    if (now - data.timestamp > maxAge) {
      connections.delete(code);
    }
  }
}