const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create required directories
const directories = [
    'uploads',
    'uploads/images',
    'uploads/audio',
    'uploads/video',
    'contacts'
];

directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
    }
});

// Configure multer for file uploads with better error handling
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (file.mimetype.startsWith('audio/')) {
            cb(null, 'uploads/audio/');
        } else if (file.mimetype.startsWith('image/')) {
            cb(null, 'uploads/images/');
        } else if (file.mimetype.startsWith('video/')) {
            cb(null, 'uploads/video/');
        } else {
            cb(new Error('Invalid file type'), false);
        }
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/') || 
            file.mimetype.startsWith('audio/') || 
            file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image, audio and video files are allowed!'), false);
        }
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit for videos
    }
});

class WhatsAppCampaignBot {
    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-blink-features=AutomationControlled',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                ]
            }
        });

        this.phoneNumbers = {
            'ALL': [],
            'INC': [],
            'BJP': [],
            'BRS': []
        };
        this.campaignMedia = {
            image: null,
            audio: null,
            video: null
        };
        this.customMessage = "";
        this.isClientReady = false;
        this.botName = "BADSI SARPANCH ELECTIONS";
        this.contactFiles = {
            'ALL': 'contacts/ALL.txt',
            'INC': 'contacts/INC.txt',
            'BJP': 'contacts/BJP.txt',
            'BRS': 'contacts/BRS.txt'
        };
        
        this.setupEventHandlers();
        this.loadContactsFromFiles();
        this.setupWebServer();
    }

    // Load contacts from text files in contacts folder
    loadContactsFromFiles() {
        console.log('📂 Loading contacts from files...');
        
        Object.keys(this.contactFiles).forEach(party => {
            const filePath = this.contactFiles[party];
            
            // Create file if it doesn't exist
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, '', 'utf8');
                console.log(`📄 Created empty contact file: ${filePath}`);
                return;
            }

            try {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                const numbers = fileContent
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && !line.startsWith('#')); // Skip empty lines and comments

                if (numbers.length > 0) {
                    const validNumbers = this.addPhoneNumbers(numbers, party, false);
                    console.log(`✅ Loaded ${validNumbers.length} contacts for ${party} from ${filePath}`);
                } else {
                    console.log(`ℹ️  No contacts found in ${filePath}`);
                }
            } catch (error) {
                console.error(`❌ Error reading ${filePath}:`, error.message);
            }
        });

        console.log(`📊 Total contacts loaded: ${this.phoneNumbers['ALL'].length}`);
        console.log(`   INC: ${this.phoneNumbers['INC'].length}`);
        console.log(`   BJP: ${this.phoneNumbers['BJP'].length}`);
        console.log(`   BRS: ${this.phoneNumbers['BRS'].length}`);
    }

    // Save contacts to text files
    saveContactsToFile(party) {
        try {
            const filePath = this.contactFiles[party];
            const numbers = this.phoneNumbers[party].map(num => num.replace('@c.us', ''));
            const content = `# ${party} Party Contacts\n# Total: ${numbers.length}\n# Last updated: ${new Date().toLocaleString()}\n\n${numbers.join('\n')}`;
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`💾 Saved ${numbers.length} contacts to ${filePath}`);
            return true;
        } catch (error) {
            console.error(`❌ Error saving contacts to file:`, error.message);
            return false;
        }
    }

    setupEventHandlers() {
        // Generate QR Code for authentication
        this.client.on('qr', (qr) => {
            console.log('📵 Scan the QR code below to connect your WhatsApp:');
            qrcode.generate(qr, { small: true });
        });

        // When client is ready
        this.client.on('ready', () => {
            console.log('✅ WhatsApp Campaign Bot is ready!');
            console.log(`📛 Bot Name: ${this.botName}`);
            this.isClientReady = true;
            this.setupProfilePrivacy();
        });

        // Handle incoming messages - SILENT MODE
        this.client.on('message', async (message) => {
            try {
                this.logMessage(message);
            } catch (error) {
                console.log('⚠️  Error logging message:', error.message);
            }
        });

        // Handle authentication failure
        this.client.on('auth_failure', (msg) => {
            console.error('❌ Authentication failed:', msg);
            this.isClientReady = false;
        });

        // Handle disconnection
        this.client.on('disconnected', (reason) => {
            console.log('🔌 Client was logged out:', reason);
            this.isClientReady = false;
            setTimeout(() => {
                console.log('🔄 Attempting to reconnect...');
                this.client.initialize();
            }, 5000);
        });
    }

    // Setup profile to hide phone number and set proper identity
    async setupProfilePrivacy() {
        try {
            // Set profile name to hide phone number
            await this.client.setDisplayName(this.botName);
            console.log(`✅ Profile name set to: ${this.botName}`);
            
            // Try to set a profile picture to further hide identity
            try {
                // Create a simple profile picture with text
                const { createCanvas } = require('canvas');
                const canvas = createCanvas(500, 500);
                const ctx = canvas.getContext('2d');
                
                // Background
                ctx.fillStyle = '#25D366';
                ctx.fillRect(0, 0, 500, 500);
                
                // Text
                ctx.fillStyle = '#FFFFFF';
                ctx.font = 'bold 40px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('BADSI', 250, 200);
                ctx.fillText('SARPANCH', 250, 250);
                ctx.fillText('ELECTIONS', 250, 300);
                
                // Save and set as profile picture
                const buffer = canvas.toBuffer('image/jpeg');
                const profilePath = path.join(__dirname, 'uploads', 'profile_temp.jpg');
                fs.writeFileSync(profilePath, buffer);
                
                const profileMedia = MessageMedia.fromFilePath(profilePath);
                await this.client.setProfilePicture(profileMedia);
                console.log('✅ Profile picture set to hide phone number');
                
                // Clean up temp file
                setTimeout(() => {
                    if (fs.existsSync(profilePath)) {
                        fs.unlinkSync(profilePath);
                    }
                }, 5000);
                
            } catch (profileError) {
                console.log('ℹ️  Could not set profile picture (normal for some accounts)');
            }
            
        } catch (error) {
            console.log('⚠️  Profile setup limited:', error.message);
        }
    }

    // Safe message logging
    async logMessage(message) {
        try {
            console.log('📨 Incoming Message:');
            console.log(`   From: ${this.botName}`);
            console.log(`   Type: ${message.type}`);
            console.log(`   Message: ${message.body ? message.body.substring(0, 100) : 'Media message'}${message.body && message.body.length > 100 ? '...' : ''}`);
            console.log(`   Time: ${new Date(message.timestamp * 1000).toLocaleString()}`);
            console.log('   ──────────────────────────────');
        } catch (error) {
            console.log('📨 Incoming Message (Basic Info)');
        }
    }

    // Validate and format phone numbers with party assignment
    addPhoneNumbers(numbers, party = 'ALL', saveToFile = true) {
        const cleanedNumbers = numbers.map(num => {
            let cleanNum = num.replace(/\D/g, '');
            cleanNum = cleanNum.replace(/^0+/, '');
            
            if (!cleanNum.startsWith('91') && cleanNum.length === 10) {
                cleanNum = '91' + cleanNum;
            }
            
            return cleanNum.endsWith('@c.us') ? cleanNum : cleanNum + '@c.us';
        }).filter(num => {
            return num.match(/^91\d{10}@c\.us$/);
        });
        
        // Add to specified party
        this.phoneNumbers[party] = [...new Set([...this.phoneNumbers[party], ...cleanedNumbers])];
        
        // Also add to ALL if not already there
        if (party !== 'ALL') {
            this.phoneNumbers['ALL'] = [...new Set([...this.phoneNumbers['ALL'], ...cleanedNumbers])];
        }
        
        // Save to file
        if (saveToFile) {
            this.saveContactsToFile(party);
            if (party !== 'ALL') {
                this.saveContactsToFile('ALL');
            }
        }
        
        return cleanedNumbers;
    }

    // Get numbers by party
    getNumbersByParty(party = 'ALL') {
        return this.phoneNumbers[party] || [];
    }

    // Get all parties with counts
    getPartyStats() {
        const stats = {};
        Object.keys(this.phoneNumbers).forEach(party => {
            stats[party] = this.phoneNumbers[party].length;
        });
        return stats;
    }

    // Get masked number for display
    getMaskedNumber(number) {
        if (!number) return 'Hidden Number';
        const cleanNum = number.replace('@c.us', '');
        return `XXXXXX${cleanNum.slice(-4)}`;
    }

    // Set campaign media
    setCampaignMedia(type, filePath) {
        // Remove old file if exists
        if (this.campaignMedia[type] && fs.existsSync(this.campaignMedia[type])) {
            try {
                fs.unlinkSync(this.campaignMedia[type]);
            } catch (error) {
                console.log(`⚠️  Could not delete old ${type} file:`, error.message);
            }
        }
        
        this.campaignMedia[type] = filePath;
        console.log(`✅ ${type.toUpperCase()} file set: ${path.basename(filePath)}`);
        return filePath;
    }

    // Set custom message
    setCustomMessage(message) {
        this.customMessage = message;
        console.log('✅ Custom message saved');
        return message;
    }

    // Send campaign to specific party
    async sendCampaign(campaignType = 'text', selectedParty = 'ALL') {
        if (!this.isClientReady) {
            throw new Error('WhatsApp client is not ready. Please check connection.');
        }

        const targetNumbers = this.getNumbersByParty(selectedParty);
        
        if (targetNumbers.length === 0) {
            throw new Error(`No contacts found for ${selectedParty} party`);
        }

        if (!this.customMessage || this.customMessage.trim().length === 0) {
            throw new Error('No custom message set. Please add a message first.');
        }

        const message = this.customMessage;
        let media = null;
        let mediaType = 'text';

        // Load media based on type
        if (campaignType === 'image' && this.campaignMedia.image && fs.existsSync(this.campaignMedia.image)) {
            try {
                media = MessageMedia.fromFilePath(this.campaignMedia.image);
                mediaType = 'image';
                console.log('📷 Campaign image loaded successfully');
            } catch (error) {
                console.log('❌ Could not load image:', error.message);
                throw new Error('Failed to load image file: ' + error.message);
            }
        } else if (campaignType === 'audio' && this.campaignMedia.audio && fs.existsSync(this.campaignMedia.audio)) {
            try {
                media = MessageMedia.fromFilePath(this.campaignMedia.audio);
                mediaType = 'audio';
                console.log('🔊 Campaign audio loaded successfully');
            } catch (error) {
                console.log('❌ Could not load audio:', error.message);
                throw new Error('Failed to load audio file: ' + error.message);
            }
        } else if (campaignType === 'video' && this.campaignMedia.video && fs.existsSync(this.campaignMedia.video)) {
            try {
                media = MessageMedia.fromFilePath(this.campaignMedia.video);
                mediaType = 'video';
                console.log('🎥 Campaign video loaded successfully');
            } catch (error) {
                console.log('❌ Could not load video:', error.message);
                throw new Error('Failed to load video file: ' + error.message);
            }
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        console.log(`🚀 Starting ${mediaType.toUpperCase()} campaign for ${selectedParty} party to ${targetNumbers.length} contacts...`);

        for (const number of targetNumbers) {
            const maskedNumber = this.getMaskedNumber(number);
            
            try {
                if (media) {
                    if (mediaType === 'audio') {
                        // Send audio as voice note
                        await this.client.sendMessage(number, media, { sendAudioAsVoice: true });
                    } else if (mediaType === 'image') {
                        // Send image with caption
                        await this.client.sendMessage(number, media, { caption: message });
                    } else if (mediaType === 'video') {
                        // Send video with caption
                        await this.client.sendMessage(number, media, { caption: message });
                    }
                } else {
                    // Send text only
                    await this.client.sendMessage(number, message);
                }
                
                results.push({ number: maskedNumber, status: 'success' });
                successCount++;
                console.log(`✅ ${mediaType.toUpperCase()} sent to ${selectedParty}: ${maskedNumber}`);
                
                // Add delay to avoid rate limiting (longer for videos)
                const delay = mediaType === 'video' ? 5000 : 3000;
                await new Promise(resolve => setTimeout(resolve, delay));
                
            } catch (error) {
                results.push({ number: maskedNumber, status: 'failed', error: error.message });
                failCount++;
                console.error(`❌ Failed to send to ${selectedParty} - ${maskedNumber}:`, error.message);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        console.log(`📊 ${selectedParty} Party Campaign completed: ${successCount} successful, ${failCount} failed`);
        return { 
            total: targetNumbers.length, 
            success: successCount, 
            failed: failCount, 
            results,
            party: selectedParty
        };
    }

    // Setup web server
    setupWebServer() {
        const app = express();
        const PORT = process.env.PORT || 3000;

        app.use(bodyParser.json({ limit: '100mb' }));
        app.use(bodyParser.urlencoded({ extended: true, limit: '100mb' }));
        app.use(express.static('public'));

        // API Routes
        app.post('/add-numbers', (req, res) => {
            try {
                const { numbers, party = 'ALL' } = req.body;
                if (!numbers || !Array.isArray(numbers)) {
                    return res.json({ success: false, error: 'Invalid numbers format' });
                }
                
                const validParties = ['ALL', 'INC', 'BJP', 'BRS'];
                if (!validParties.includes(party)) {
                    return res.json({ success: false, error: 'Invalid party selection' });
                }
                
                const addedNumbers = this.addPhoneNumbers(numbers, party);
                const partyStats = this.getPartyStats();
                
                res.json({ 
                    success: true, 
                    added: addedNumbers.length, 
                    total: this.phoneNumbers['ALL'].length,
                    partyStats: partyStats,
                    invalid: numbers.length - addedNumbers.length
                });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        app.post('/upload-image', upload.single('image'), (req, res) => {
            try {
                if (!req.file) {
                    return res.json({ success: false, error: 'No image file uploaded' });
                }
                const imagePath = this.setCampaignMedia('image', req.file.path);
                res.json({ 
                    success: true, 
                    path: imagePath, 
                    filename: path.basename(imagePath),
                    type: 'image' 
                });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        app.post('/upload-audio', upload.single('audio'), (req, res) => {
            try {
                if (!req.file) {
                    return res.json({ success: false, error: 'No audio file uploaded' });
                }
                const audioPath = this.setCampaignMedia('audio', req.file.path);
                res.json({ 
                    success: true, 
                    path: audioPath, 
                    filename: path.basename(audioPath),
                    type: 'audio' 
                });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        app.post('/upload-video', upload.single('video'), (req, res) => {
            try {
                if (!req.file) {
                    return res.json({ success: false, error: 'No video file uploaded' });
                }
                const videoPath = this.setCampaignMedia('video', req.file.path);
                res.json({ 
                    success: true, 
                    path: videoPath, 
                    filename: path.basename(videoPath),
                    type: 'video' 
                });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        app.post('/set-message', (req, res) => {
            try {
                const { message } = req.body;
                if (!message || message.trim().length === 0) {
                    return res.json({ success: false, error: 'Message cannot be empty' });
                }
                const savedMessage = this.setCustomMessage(message.trim());
                res.json({ success: true, message: savedMessage });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        app.post('/send-campaign', async (req, res) => {
            try {
                const { campaignType = 'text', party = 'ALL' } = req.body;
                const result = await this.sendCampaign(campaignType, party);
                res.json({ success: true, data: result });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        app.post('/clear-numbers', (req, res) => {
            try {
                const { party } = req.body;
                if (party && this.phoneNumbers[party]) {
                    this.phoneNumbers[party] = [];
                    this.saveContactsToFile(party);
                    
                    // Also update ALL if clearing a specific party
                    if (party !== 'ALL') {
                        // Rebuild ALL from other parties
                        this.phoneNumbers['ALL'] = [
                            ...this.phoneNumbers['INC'],
                            ...this.phoneNumbers['BJP'],
                            ...this.phoneNumbers['BRS']
                        ];
                        this.phoneNumbers['ALL'] = [...new Set(this.phoneNumbers['ALL'])];
                        this.saveContactsToFile('ALL');
                    }
                    res.json({ success: true, message: `${party} party numbers cleared` });
                } else {
                    // Clear all parties
                    Object.keys(this.phoneNumbers).forEach(p => {
                        this.phoneNumbers[p] = [];
                        this.saveContactsToFile(p);
                    });
                    res.json({ success: true, message: 'All numbers cleared' });
                }
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        app.post('/clear-media', (req, res) => {
            try {
                const { type } = req.body;
                if (type && this.campaignMedia[type]) {
                    if (fs.existsSync(this.campaignMedia[type])) {
                        fs.unlinkSync(this.campaignMedia[type]);
                    }
                    this.campaignMedia[type] = null;
                    res.json({ success: true, message: `${type} cleared successfully` });
                } else {
                    res.json({ success: false, error: 'Invalid media type' });
                }
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        app.get('/numbers', (req, res) => {
            const { party = 'ALL' } = req.query;
            const numbers = this.getNumbersByParty(party).map(num => this.getMaskedNumber(num));
            res.json({ 
                numbers: numbers, 
                total: numbers.length,
                party: party
            });
        });

        app.get('/party-stats', (req, res) => {
            res.json({ 
                partyStats: this.getPartyStats(),
                total: this.phoneNumbers['ALL'].length
            });
        });

        app.get('/status', (req, res) => {
            res.json({ 
                ready: this.isClientReady, 
                totalNumbers: this.phoneNumbers['ALL'].length,
                hasImage: !!this.campaignMedia.image,
                hasAudio: !!this.campaignMedia.audio,
                hasVideo: !!this.campaignMedia.video,
                hasMessage: !!this.customMessage && this.customMessage.length > 0,
                botName: this.botName,
                partyStats: this.getPartyStats()
            });
        });

        app.post('/reload-contacts', (req, res) => {
            try {
                // Clear existing numbers
                Object.keys(this.phoneNumbers).forEach(party => {
                    this.phoneNumbers[party] = [];
                });
                
                // Reload from files
                this.loadContactsFromFiles();
                
                res.json({ 
                    success: true, 
                    message: 'Contacts reloaded from files',
                    partyStats: this.getPartyStats(),
                    total: this.phoneNumbers['ALL'].length
                });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Error handling middleware
        app.use((error, req, res, next) => {
            if (error instanceof multer.MulterError) {
                if (error.code === 'LIMIT_FILE_SIZE') {
                    return res.json({ success: false, error: 'File too large. Maximum size is 100MB.' });
                }
            }
            res.json({ success: false, error: error.message });
        });

        this.server = app.listen(PORT, () => {
            console.log(`🌐 Admin panel running at http://localhost:${PORT}`);
        });
    }

    // Initialize the bot
    initialize() {
        this.client.initialize();
        console.log('🚀 Initializing WhatsApp Campaign Bot...');
        console.log(`📛 Bot Identity: ${this.botName}`);
        console.log('🔒 Privacy Mode: Phone number hidden with profile setup');
        console.log('🎪 Party System: ALL, INC, BJP, BRS');
        console.log('🎵 Features: Custom messages with image/audio/video support');
        console.log('📂 Contact Files: Loading from contacts/ folder');
        console.log('🌐 Admin Panel: http://localhost:3000');
    }
}

// Create and start the bot
const bot = new WhatsAppCampaignBot();
bot.initialize();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down bot...');
    await bot.client.destroy();
    if (bot.server) {
        bot.server.close();
    }
    process.exit(0);
});
