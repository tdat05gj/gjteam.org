const express = require('express');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where, updateDoc } = require('firebase/firestore');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Middleware để đảm bảo luôn trả về JSON
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    next();
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Firebase configuration mã hóa Base64
const encodedFirebaseConfig = "eyJhcGlLZXkiOiJBSXphU3lCam9GQUFyRVZBZkZHSEhlTEwtV0M0cldMLUhDaDZKeEUiLCJhdXRoRG9tYWluIjoiZ2pwcm9qZWN0MS0zN2UyOS5maXJlYmFzZWFwcC5jb20iLCJwcm9qZWN0SWQiOiJnanByb2plY3QxLTM3ZTI5Iiwic3RvcmFnZUJ1Y2tldCI6ImdqcHJvamVjdDEtMzdlMjkuZmlyZWJhc2VzdG9yYWdlLmFwcCIsIm1lc3NhZ2luZ1NlbmRlcklkIjoiNzMzNjU4NDk5ODEiLCJhcHBJZCI6IjE6NzMzNjX4NDk5ODE6d2ViOmNlMTViZjI5YTA2M2ViMWE3OGFlMTQiLCJtZWFzdXJlbWVudElkIjoiRy1SUFhGSFhWVDFZIn0=";

// Giải mã Base64 thành object
const firebaseConfig = JSON.parse(Buffer.from(encodedFirebaseConfig, 'base64').toString('utf8'));

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Ethereum provider và contract
const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.org');
const contractAddress = '0xe178D0a445982f6A35e9C61f797Dcf47Ef610292';
const contractAbi = [
    "function recordPurchase(address buyer, uint256 sethAmount) external",
    "function withdrawEth() external",
    "function userBalances(address) view returns (uint256)"
];

// Hàm mã hóa private key
function encryptKey(key, password) {
    const iv = crypto.randomBytes(16);
    const keyBuffer = crypto.createHash('sha256').update(password).digest();
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
    let encrypted = cipher.update(key, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { iv: iv.toString('hex'), encryptedKey: encrypted };
}

// Hàm giải mã private key
function decryptKey(encryptedKey, iv, password) {
    const keyBuffer = crypto.createHash('sha256').update(password).digest();
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encryptedKey, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// Tạo và lưu ví mới
function createAndSaveWallet() {
    const wallet = ethers.Wallet.createRandom();
    const privateKey = wallet.privateKey;
    const address = wallet.address;

    const password = process.env.WALLET_PASSWORD || 'YOUR_PASSWORD'; // Use env var
    const { iv, encryptedKey } = encryptKey(privateKey, password);

    // Dynamic path for wallet file
    const walletDir = process.env.WALLET_PATH || path.join(__dirname, 'wallet');
    const walletPath = path.join(walletDir, 'wallet.json');

    // Create directory if it doesn't exist
    if (!fs.existsSync(walletDir)) {
        fs.mkdirSync(walletDir, { recursive: true });
    }

    fs.writeFileSync(walletPath, JSON.stringify({ address, iv, encryptedKey }, null, 2));

    console.log(`Ví mới được tạo: ${address}`);
    console.log(`Đã lưu ví vào ${walletPath}. Sao lưu file này an toàn!`);

    return wallet;
}

// Đọc ví từ file
function loadWallet(password) {
    const walletDir = process.env.WALLET_PATH || path.join(__dirname, 'wallet');
    const walletPath = path.join(walletDir, 'wallet.json');
    const data = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const decryptedKey = decryptKey(data.encryptedKey, data.iv, password);
    return new ethers.Wallet(decryptedKey, provider);
}

// Tạo hoặc tải ví
let wallet;
const walletDir = process.env.WALLET_PATH || path.join(__dirname, 'wallet');
const walletPath = path.join(walletDir, 'wallet.json');
if (!fs.existsSync(walletPath)) {
    wallet = createAndSaveWallet();
} else {
    wallet = loadWallet(process.env.WALLET_PASSWORD || 'YOUR_PASSWORD');
}

const contract = new ethers.Contract(contractAddress, contractAbi, wallet);

// Hàm xử lý giao dịch
async function processPurchases() {
    try {
        const purchasesRef = collection(db, 'purchases');
        const q = query(purchasesRef, where('processed', '==', false));
        const querySnapshot = await getDocs(q);

        for (const doc of querySnapshot.docs) {
            const data = doc.data();
            const { userAddress, sethAmount, txHash } = data;

            console.log(`Xử lý giao dịch ${txHash} cho ${userAddress}`);

            // Gọi contract để ghi nhận và gửi ETH Sepolia
            const tx = await contract.recordPurchase(userAddress, ethers.parseEther(sethAmount.toString()));
            await tx.wait();

            console.log(`Giao dịch ${txHash} xử lý thành công. Tx: ${tx.hash}`);

            // Cập nhật trạng thái trong Firestore
            await updateDoc(doc.ref, { processed: true });
        }
    } catch (error) {
        console.error('Lỗi xử lý giao dịch:', error);
    }
}

// Chạy xử lý giao dịch mỗi 5 phút
setInterval(processPurchases, 5 * 60 * 1000);
processPurchases();

// Endpoint tạo ví với đuôi tùy chỉnh
const createWallet = () => {
    const wallet = ethers.Wallet.createRandom();
    return {
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: wallet.mnemonic.phrase
    };
};

app.post('/generate', async (req, res) => {
    try {
        const desiredEnding = req.body.ending;

        if (!desiredEnding || typeof desiredEnding !== 'string') {
            return res.status(400).json({ success: false, error: 'Invalid ending specified' });
        }

        let found = false;
        let walletInfo;

        while (!found) {
            if (req.aborted) {
                return res.status(499).json({ success: false, error: 'Request cancelled by client' });
            }
            const wallet = createWallet();
            if (wallet.address.endsWith(desiredEnding)) {
                found = true;
                walletInfo = wallet;
            }
        }

        res.json({ success: true, ...walletInfo });
    } catch (error) {
        console.error('Error in /generate:', error);
        res.status(500).json({ success: false, error: error.message || 'Server error' });
    }
});

// Endpoint tạo nhiều ví ngẫu nhiên
app.post('/generate-multiple', async (req, res) => {
    try {
        const numWallets = req.body.numWallets;
        if (!numWallets || typeof numWallets !== 'number' || numWallets < 1) {
            return res.status(400).json({ success: false, error: 'Invalid number of wallets specified' });
        }
        if (numWallets > 100) {
            return res.status(400).json({ success: false, error: 'Maximum 100 wallets allowed' });
        }

        const wallets = [];
        for (let i = 0; i < numWallets; i++) {
            if (req.aborted) {
                return res.status(499).json({ success: false, error: 'Request cancelled by client' });
            }
            const wallet = createWallet();
            wallets.push(wallet);
        }

        res.json({ success: true, wallets: wallets });
    } catch (error) {
        console.error('Error in /generate-multiple:', error);
        res.status(500).json({ success: false, error: error.message || 'Server error' });
    }
});

// Xử lý lỗi không tìm thấy route
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Route not found' });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});