const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Create HTTP server that also serves the HTML file
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        // Serve the HTML file
        const htmlPath = path.join(__dirname, 'index.html');
        
        fs.readFile(htmlPath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('HTML file not found. Make sure index.html is in the same directory.');
                return;
            }
            
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
});

const wss = new WebSocket.Server({ server });

// Store active connections and offers
const connections = new Map(); // code -> { sender: ws, receiver: ws, offer: string }
const offers = new Map(); // code -> offer data

console.log('WebRTC Signaling Server Starting...');

wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Error parsing message:', error);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: 'Invalid message format' 
            }));
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        // Clean up any stored data for this connection
        cleanupConnection(ws);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function handleMessage(ws, data) {
    const { type, code } = data;
    
    switch (type) {
        case 'store-offer':
            // Sender stores their offer with a code
            console.log(`Storing offer for code: ${code}`);
            offers.set(code, {
                offer: data.offer,
                senderWs: ws,
                timestamp: Date.now()
            });
            
            // Clean up old offers (older than 10 minutes)
            cleanupOldOffers();
            break;
            
        case 'request-offer':
            // Receiver requests offer using code
            console.log(`Offer requested for code: ${code}`);
            const storedOffer = offers.get(code);
            
            if (!storedOffer) {
                ws.send(JSON.stringify({ 
                    type: 'error', 
                    message: 'Invalid code or code expired' 
                }));
                return;
            }
            
            // Send offer to receiver
            ws.send(JSON.stringify({
                type: 'offer',
                offer: storedOffer.offer
            }));
            
            // Store receiver connection for answer forwarding
            connections.set(code, {
                sender: storedOffer.senderWs,
                receiver: ws
            });
            break;
            
        case 'answer':
            // Receiver sends answer back to sender
            console.log(`Answer received for code: ${code}`);
            const connection = connections.get(code);
            
            if (!connection || !connection.sender) {
                ws.send(JSON.stringify({ 
                    type: 'error', 
                    message: 'Sender not found' 
                }));
                return;
            }
            
            // Forward answer to sender
            connection.sender.send(JSON.stringify({
                type: 'answer',
                answer: data.answer
            }));
            
            // Clean up after successful connection
            setTimeout(() => {
                offers.delete(code);
                connections.delete(code);
                console.log(`Cleaned up connection data for code: ${code}`);
            }, 5000);
            break;
            
        default:
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: 'Unknown message type' 
            }));
    }
}

function cleanupConnection(ws) {
    // Remove any stored offers or connections for this WebSocket
    for (const [code, data] of offers.entries()) {
        if (data.senderWs === ws) {
            offers.delete(code);
            console.log(`Cleaned up offer for code: ${code}`);
        }
    }
    
    for (const [code, data] of connections.entries()) {
        if (data.sender === ws || data.receiver === ws) {
            connections.delete(code);
            console.log(`Cleaned up connection for code: ${code}`);
        }
    }
}

function cleanupOldOffers() {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    
    for (const [code, data] of offers.entries()) {
        if (now - data.timestamp > maxAge) {
            offers.delete(code);
            console.log(`Expired offer for code: ${code}`);
        }
    }
}

// Start cleanup interval
setInterval(cleanupOldOffers, 60000); // Clean up every minute

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`WebRTC File Transfer Server running on port ${PORT}`);
    console.log(`Open your browser and go to: http://localhost:${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop the server');
});

// Graceful shutdown - fix the duplicate listener issue
let isShuttingDown = false;

function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log('\nShutting down server...');
    wss.close(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);