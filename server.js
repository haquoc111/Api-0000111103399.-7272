const express = require('express');
const CryptoJS = require('crypto-js');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// ========== CẤU HÌNH API & DỮ LIỆU MẪU ==========
const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=2cff2322cadccdcb7afd52aa2f828f83';

let gameHistory = [];       // Mảng các kết quả 'Tài' hoặc 'Xỉu'
let currentSessionId = null;

// Dữ liệu mẫu (mock) dùng khi API lỗi hoặc không có dữ liệu
const MOCK_SESSIONS = [
    { phien: 1001, ket_qua: 'Tài', xuc_xac_1: 5, xuc_xac_2: 5, xuc_xac_3: 5, tong: 15 },
    { phien: 1002, ket_qua: 'Tài', xuc_xac_1: 6, xuc_xac_2: 5, xuc_xac_3: 4, tong: 15 },
    { phien: 1003, ket_qua: 'Xỉu', xuc_xac_1: 2, xuc_xac_2: 2, xuc_xac_3: 3, tong: 7 },
    { phien: 1004, ket_qua: 'Xỉu', xuc_xac_1: 1, xuc_xac_2: 2, xuc_xac_3: 3, tong: 6 },
    { phien: 1005, ket_qua: 'Tài', xuc_xac_1: 4, xuc_xac_2: 5, xuc_xac_3: 6, tong: 15 },
    { phien: 1006, ket_qua: 'Tài', xuc_xac_1: 5, xuc_xac_2: 5, xuc_xac_3: 5, tong: 15 },
    { phien: 1007, ket_qua: 'Tài', xuc_xac_1: 6, xuc_xac_2: 6, xuc_xac_3: 3, tong: 15 },
    { phien: 1008, ket_qua: 'Xỉu', xuc_xac_1: 2, xuc_xac_2: 2, xuc_xac_3: 2, tong: 6 },
    { phien: 1009, ket_qua: 'Xỉu', xuc_xac_1: 1, xuc_xac_2: 1, xuc_xac_3: 5, tong: 7 },
    { phien: 1010, ket_qua: 'Tài', xuc_xac_1: 4, xuc_xac_2: 5, xuc_xac_3: 6, tong: 15 },
    { phien: 1011, ket_qua: 'Tài', xuc_xac_1: 5, xuc_xac_2: 5, xuc_xac_3: 5, tong: 15 },
    { phien: 1012, ket_qua: 'Xỉu', xuc_xac_1: 2, xuc_xac_2: 3, xuc_xac_3: 2, tong: 7 },
    { phien: 1013, ket_qua: 'Xỉu', xuc_xac_1: 1, xuc_xac_2: 2, xuc_xac_3: 3, tong: 6 },
    { phien: 1014, ket_qua: 'Tài', xuc_xac_1: 4, xuc_xac_2: 5, xuc_xac_3: 6, tong: 15 },
    { phien: 1015, ket_qua: 'Tài', xuc_xac_1: 6, xuc_xac_2: 6, xuc_xac_3: 6, tong: 18 }
];

// ========== 1. THUẬT TOÁN MD5 ĐỈNH CAO ==========
function duDoanDinhCao(md5, lichSu15) {
    let bytes = [];
    for (let i = 0; i < 32; i += 2) bytes.push(parseInt(md5.substr(i, 2), 16));
    let tong = bytes.reduce((a, b) => a + b, 0);
    let tb = tong / 16;
    let ps = 0;
    for (let b of bytes) ps += (b - tb) ** 2;
    ps /= 16;
    let entropy = 0;
    let dem = {};
    for (let b of bytes) dem[b] = (dem[b] || 0) + 1;
    for (let k in dem) { let p = dem[k] / 16; entropy -= p * Math.log2(p); }
    let md5Score = 0;
    if (tong % 6 >= 3) md5Score += 0.25;
    if (bytes[0] > 220 && bytes[15] < 70) md5Score += 0.35;
    if (bytes[15] < 30 && ps > 3500) md5Score -= 0.4;
    if (entropy > 3.6) md5Score -= 0.2;
    if (ps < 2000) md5Score += 0.2;
    let thongKe = { T: 0, X: 0 };
    for (let k of lichSu15) thongKe[k]++;
    let tiLeTai = thongKe.T / 15;
    let maxLap = 1, lapHT = 1, cau11 = 0, cauNgich = 0;
    for (let i = 1; i < lichSu15.length; i++) {
        if (lichSu15[i] === lichSu15[i-1]) { lapHT++; if (lapHT > maxLap) maxLap = lapHT; }
        else { lapHT = 1; }
        if (i >= 2 && lichSu15[i] !== lichSu15[i-1] && lichSu15[i-1] !== lichSu15[i-2]) cau11++;
        if (i >= 2 && lichSu15[i] === lichSu15[i-2] && lichSu15[i] !== lichSu15[i-1]) cauNgich++;
    }
    let last3 = lichSu15.slice(-3);
    let cauThuan = (last3[0] === last3[1] && last3[1] === last3[2]) ? 2 : (last3[0] === last3[1] || last3[1] === last3[2]) ? 1 : 0;
    let cauScore = 0;
    if (maxLap >= 4) cauScore = (lichSu15[lichSu15.length-1] === "T") ? 0.8 : -0.8;
    else if (cau11 >= 5) cauScore = (lichSu15[lichSu15.length-1] === "T") ? -0.7 : 0.7;
    else if (cauNgich >= 4) cauScore = (lichSu15[lichSu15.length-1] === "T") ? 0.6 : -0.6;
    else if (tiLeTai > 0.65) cauScore = -0.5;
    else if (tiLeTai < 0.35) cauScore = 0.5;
    else cauScore = (cauThuan === 2) ? 0.4 : (cauThuan === 1) ? 0.2 : 0;
    let finalScore = md5Score * 0.4 + cauScore * 0.6;
    let randomFactor = (bytes[8] % 100) / 100;
    let duDoan = "";
    let doTin = 0;
    if (Math.abs(finalScore) > 0.45) {
        duDoan = finalScore > 0 ? "TAI" : "XIU";
        doTin = 70 + Math.abs(finalScore) * 50;
    } else if (Math.abs(finalScore) > 0.2) {
        duDoan = finalScore > 0 ? "TAI" : "XIU";
        doTin = 55 + Math.abs(finalScore) * 40;
    } else {
        duDoan = randomFactor > 0.55 ? "TAI" : "XIU";
        doTin = 50 + Math.abs(randomFactor - 0.5) * 30;
    }
    if (maxLap >= 6) doTin = Math.min(96, doTin + 15);
    if (cau11 >= 8) doTin = Math.min(96, doTin + 12);
    if (tiLeTai > 0.8 || tiLeTai < 0.2) doTin = Math.min(96, doTin + 10);
    return { duDoan: duDoan, doTinCay: Math.round(doTin), md5Score: md5Score, cauScore: cauScore };
}

// ========== 2. BỘ NHỚ CẦU (từ api.js) ==========
let cauMemoryBank = {
    biet: { Tai: {}, Xiu: {}, stats: { maxTai: 0, maxXiu: 0, avgTai: 0, avgXiu: 0, totalBietTai: 0, totalBietXiu: 0 } },
    c11: { patterns: {}, stats: { total: 0, maxLength: 0, breakRate: {} } },
    c22: { patterns: {}, stats: { total: 0, maxLength: 0, phaseAccuracy: {} } }
};

function updateCauMemory(result, lichSu) {
    let n = lichSu.length;
    if (n < 3) return;
    let streak = 1;
    for (let i = n-2; i>=0; i--) {
        if (lichSu[i] === result) streak++;
        else break;
    }
    if (streak >= 3) {
        if (result === 'Tài') {
            cauMemoryBank.biet.Tai[streak] = (cauMemoryBank.biet.Tai[streak]||0)+1;
            cauMemoryBank.biet.stats.totalBietTai++;
            if (streak > cauMemoryBank.biet.stats.maxTai) cauMemoryBank.biet.stats.maxTai = streak;
        } else {
            cauMemoryBank.biet.Xiu[streak] = (cauMemoryBank.biet.Xiu[streak]||0)+1;
            cauMemoryBank.biet.stats.totalBietXiu++;
            if (streak > cauMemoryBank.biet.stats.maxXiu) cauMemoryBank.biet.stats.maxXiu = streak;
        }
    }
    if (n >= 6) {
        let last6 = lichSu.slice(-6);
        let is11 = true;
        for (let i=1; i<6; i++) { if (last6[i]===last6[i-1]) { is11=false; break; } }
        if (is11) {
            let pattern = last6.join(',');
            cauMemoryBank.c11.patterns[pattern] = (cauMemoryBank.c11.patterns[pattern]||0)+1;
            cauMemoryBank.c11.stats.total++;
        }
    }
    if (n >= 8) {
        let last8 = lichSu.slice(-8);
        let is22 = true;
        for (let i=0; i<8; i+=2) { if (last8[i]!==last8[i+1]) { is22=false; break; } }
        if (is22 && last8[0]!==last8[2]) {
            let pattern = last8.join(',');
            cauMemoryBank.c22.patterns[pattern] = (cauMemoryBank.c22.patterns[pattern]||0)+1;
            cauMemoryBank.c22.stats.total++;
        }
    }
}

function predictFromCauMemory(lichSu) {
    let n = lichSu.length;
    if (n < 5) return null;
    let lastResult = lichSu[n-1];
    let streak = 1;
    for (let i=n-2; i>=0; i--) {
        if (lichSu[i] === lastResult) streak++;
        else break;
    }
    if (streak >= 3) {
        let countLonger = 0, countThis = 0;
        for (let s=streak+1; s<=Math.min(50, cauMemoryBank.biet.stats['max'+lastResult]||50); s++) {
            countLonger += lastResult==='Tài' ? (cauMemoryBank.biet.Tai[s]||0) : (cauMemoryBank.biet.Xiu[s]||0);
        }
        countThis = lastResult==='Tài' ? (cauMemoryBank.biet.Tai[streak]||0) : (cauMemoryBank.biet.Xiu[streak]||0);
        let total = countThis + countLonger;
        if (total > 0) {
            let probContinue = countLonger/total;
            if (Math.abs(probContinue-0.5) > 0.15) {
                let prediction = probContinue>0.5 ? lastResult : (lastResult==='Tài'?'Xỉu':'Tài');
                let confidence = Math.abs(probContinue-0.5)*2+0.3;
                return { prediction, confidence: Math.min(95, confidence*100) };
            }
        }
    }
    return null;
}

// ========== 3. CÁC HÀM TỪ predictionAlgorithmsAll.js ==========
function detectStreakAndBreak(history) {
    if (!history || history.length === 0) return { streak: 0, currentResult: null, breakProb: 0.0 };
    let streak = 1;
    const currentResult = history[history.length - 1];
    for (let i = history.length - 2; i >= 0; i--) {
        if (history[i] === currentResult) streak++;
        else break;
    }
    const last20 = history.slice(-20);
    if (!last20.length) return { streak, currentResult, breakProb: 0.0 };
    const switches = last20.slice(1).reduce((count, curr, idx) => count + (curr !== last20[idx] ? 1 : 0), 0);
    const taiCount = last20.filter(r => r === 'Tài').length;
    const xiuCount = last20.filter(r => r === 'Xỉu').length;
    const imbalance = Math.abs(taiCount - xiuCount) / last20.length;
    let breakProb = 0.0;
    if (streak >= 8) breakProb = Math.min(0.6 + (switches / 20) + imbalance * 0.15, 0.9);
    else if (streak >= 5) breakProb = Math.min(0.35 + (switches / 15) + imbalance * 0.25, 0.85);
    else if (streak >= 3 && switches >= 8) breakProb = 0.3;
    return { streak, currentResult, breakProb };
}

function smartBridgeBreak(history) {
    if (!history || history.length < 5) return { prediction: null, breakProb: 0.0, reason: 'Không đủ dữ liệu' };
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    let breakProbability = breakProb;
    let reason = '';
    if (streak >= 7) {
        breakProbability = Math.min(breakProbability + 0.15, 0.9);
        reason = `[Bẻ Cầu] Chuỗi ${streak} ${currentResult} dài, khả năng bẻ cầu cao`;
    } else {
        breakProbability = Math.max(breakProbability - 0.15, 0.15);
        reason = `[Bẻ Cầu] Không phát hiện mẫu bẻ cầu mạnh, tiếp tục theo cầu`;
    }
    let prediction = breakProbability > 0.55 ? (currentResult === 'Tài' ? 2 : 1) : (currentResult === 'Tài' ? 1 : 2);
    return { prediction, breakProb: breakProbability, reason };
}

function aiHtddLogic(history) {
    if (!history || history.length < 5) {
        const randomResult = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
        return { prediction: randomResult, reason: '[AI] Không đủ lịch sử, dự đoán ngẫu nhiên' };
    }
    const recentHistory = history.slice(-7);
    const taiCount = recentHistory.filter(r => r === 'Tài').length;
    const xiuCount = recentHistory.filter(r => r === 'Xỉu').length;
    if (history.length >= 5) {
        const last5 = history.slice(-5);
        if (last5.join(',') === 'Tài,Xỉu,Tài,Xỉu,Tài') return { prediction: 'Xỉu', reason: '[AI] Phát hiện mẫu 1T1X lặp → tiếp theo nên đánh Xỉu' };
        if (last5.join(',') === 'Xỉu,Tài,Xỉu,Tài,Xỉu') return { prediction: 'Tài', reason: '[AI] Phát hiện mẫu 1X1T lặp → tiếp theo nên đánh Tài' };
    }
    if (history.length >= 10 && history.slice(-7).every(h => h === 'Tài')) return { prediction: 'Xỉu', reason: '[AI] Chuỗi Tài quá dài (7 lần) → dự đoán Xỉu' };
    if (history.length >= 10 && history.slice(-7).every(h => h === 'Xỉu')) return { prediction: 'Tài', reason: '[AI] Chuỗi Xỉu quá dài (7 lần) → dự đoán Tài' };
    const overallTai = history.filter(h => h === 'Tài').length;
    const overallXiu = history.filter(h => h === 'Xỉu').length;
    if (Math.abs(overallTai - overallXiu) / history.length > 0.3) {
        return { prediction: overallTai > overallXiu ? 'Xỉu' : 'Tài', reason: `[AI] Tổng thể ${overallTai > overallXiu ? 'Tài' : 'Xỉu'} chiếm đa số → dự đoán ngược lại` };
    }
    return { prediction: taiCount > xiuCount ? 'Xỉu' : 'Tài', reason: `[AI] Gần đây ${taiCount > xiuCount ? 'Tài' : 'Xỉu'} nhiều hơn → dự đoán ngược lại` };
}

function trendAndProb(history) {
    if (history.length < 20) return 0;
    const last20 = history.slice(-20);
    const taiCount = last20.filter(r => r === 'Tài').length;
    if (taiCount >= 13) return 2; // Xỉu
    if (taiCount <= 7) return 1;  // Tài
    return 0;
}

function shortPattern(history) {
    if (history.length < 5) return 0;
    const last4 = history.slice(-4);
    const lastResult = history[history.length - 1];
    if (last4[0] === last4[1] && last4[2] === last4[3]) {
        return lastResult === 'Tài' ? 2 : 1;
    }
    return 0;
}

function meanDeviation(history) {
    if (history.length < 20) return 0;
    const last20 = history.slice(-20);
    const taiCount = last20.filter(r => r === 'Tài').length;
    const avg = taiCount / 20;
    if (avg > 0.6) return 2;
    if (avg < 0.4) return 1;
    return 0;
}

function recentSwitch(history) {
    if (history.length < 10) return 0;
    const last10 = history.slice(-10);
    let switches = 0;
    for (let i = 1; i < 10; i++) if (last10[i] !== last10[i-1]) switches++;
    if (switches >= 7) {
        const lastResult = history[history.length - 1];
        return lastResult === 'Tài' ? 2 : 1;
    }
    return 0;
}

function predictFromFile2(history) {
    if (!history || history.length < 10) return { prediction: null, confidence: 0, reason: 'Chưa đủ dữ liệu' };
    const trendPred = trendAndProb(history);
    const shortPred = shortPattern(history);
    const meanPred = meanDeviation(history);
    const switchPred = recentSwitch(history);
    const bridgePred = smartBridgeBreak(history);
    const aiPred = aiHtddLogic(history);
    const weights = { trend: 0.2, short: 0.2, mean: 0.25, switch: 0.15, bridge: 0.2, aihtdd: 0.2 };
    let taiScore = 0, xiuScore = 0;
    if (trendPred === 1) taiScore += weights.trend; else if (trendPred === 2) xiuScore += weights.trend;
    if (shortPred === 1) taiScore += weights.short; else if (shortPred === 2) xiuScore += weights.short;
    if (meanPred === 1) taiScore += weights.mean; else if (meanPred === 2) xiuScore += weights.mean;
    if (switchPred === 1) taiScore += weights.switch; else if (switchPred === 2) xiuScore += weights.switch;
    if (bridgePred.prediction === 1) taiScore += weights.bridge; else if (bridgePred.prediction === 2) xiuScore += weights.bridge;
    if (aiPred.prediction === 'Tài') taiScore += weights.aihtdd; else xiuScore += weights.aihtdd;
    // Điều chỉnh mẫu xấu
    const { streak } = detectStreakAndBreak(history);
    const last20 = history.slice(-20);
    const switches = last20.slice(1).reduce((c,curr,i)=>c+(curr!==last20[i]?1:0),0);
    if (switches >= 10 || streak >= 10) { taiScore *= 0.85; xiuScore *= 0.85; }
    const last10Preds = history.slice(-10);
    const taiPredCount = last10Preds.filter(r=>r==='Tài').length;
    if (taiPredCount >= 7) xiuScore += 0.2;
    else if (taiPredCount <= 3) taiScore += 0.2;
    const finalPrediction = taiScore > xiuScore ? 'Xỉu' : 'Tài';
    const confidence = Math.min(95, Math.round(Math.abs(taiScore - xiuScore) * 100 + 50));
    return { prediction: finalPrediction, confidence, reason: `${aiPred.reason} | ${bridgePred.reason}`, taiScore, xiuScore };
}

// ========== 4. KẾT HỢP TẤT CẢ THUẬT TOÁN ==========
function combinedPrediction(md5, history) {
    const lichSu15 = history.slice(-15).map(r => r === 'Tài' ? 'T' : 'X');
    const md5Result = duDoanDinhCao(md5, lichSu15);
    const cauResult = predictFromCauMemory(history);
    const file2Result = predictFromFile2(history);
    const weights = { md5: 0.35, cauMemory: 0.25, file2: 0.40 };
    let taiScore = 0, xiuScore = 0, totalWeight = 0;
    // MD5
    if (md5Result.duDoan === 'TAI') taiScore += weights.md5 * (md5Result.doTinCay / 100);
    else xiuScore += weights.md5 * (md5Result.doTinCay / 100);
    totalWeight += weights.md5;
    // Cầu
    if (cauResult) {
        if (cauResult.prediction === 'Tài') taiScore += weights.cauMemory * (cauResult.confidence / 100);
        else xiuScore += weights.cauMemory * (cauResult.confidence / 100);
        totalWeight += weights.cauMemory;
    } else {
        taiScore += weights.cauMemory * 0.5;
        xiuScore += weights.cauMemory * 0.5;
        totalWeight += weights.cauMemory;
    }
    // File2
    if (file2Result.prediction === 'Tài') taiScore += weights.file2 * (file2Result.confidence / 100);
    else xiuScore += weights.file2 * (file2Result.confidence / 100);
    totalWeight += weights.file2;
    taiScore /= totalWeight; xiuScore /= totalWeight;
    let finalPrediction = '', finalConfidence = 0;
    if (Math.abs(taiScore - xiuScore) < 0.05) {
        finalPrediction = 'KHÔNG RÕ';
        finalConfidence = 50;
    } else {
        finalPrediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
        finalConfidence = Math.min(99, Math.round(Math.abs(taiScore - xiuScore) * 100 + 45));
    }
    return {
        prediction: finalPrediction,
        confidence: finalConfidence,
        details: { md5: md5Result, cauMemory: cauResult, file2: file2Result }
    };
}

// ========== 5. LẤY DỮ LIỆU TỪ API & CẬP NHẬT LỊCH SỬ ==========
async function fetchSessions() {
    try {
        console.log('🔄 Đang gọi API:', API_URL);
        const response = await fetch(API_URL, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        if (!response.ok) {
            console.warn(`⚠️ HTTP ${response.status}, dùng mock`);
            return MOCK_SESSIONS;
        }
        const data = await response.json();
        console.log('📦 API response sample:', JSON.stringify(data).slice(0, 200));
        let sessions = null;
        if (data && data.data && Array.isArray(data.data.sessions)) sessions = data.data.sessions;
        else if (data && Array.isArray(data.sessions)) sessions = data.sessions;
        else if (data && Array.isArray(data)) sessions = data;
        if (!sessions || sessions.length === 0) {
            console.warn('⚠️ Không tìm thấy mảng sessions, dùng mock');
            return MOCK_SESSIONS;
        }
        console.log(`✅ Lấy ${sessions.length} phiên từ API`);
        return sessions;
    } catch (error) {
        console.error('❌ Lỗi fetch API:', error.message);
        return MOCK_SESSIONS;
    }
}

function updateHistoryFromSessions(sessions) {
    if (!sessions || sessions.length === 0) return false;
    const newHistory = [];
    let latestId = null;
    for (const s of sessions) {
        let ketQua = s.ket_qua || s.result;
        if (!ketQua) continue;
        ketQua = (ketQua.toLowerCase().includes('tài') || ketQua === 'Tai' || ketQua === 'TAI') ? 'Tài' : 'Xỉu';
        newHistory.push(ketQua);
        const phien = s.phien || s.session_id || s.id;
        if (phien && (!latestId || phien > latestId)) latestId = phien;
    }
    if (newHistory.length === 0) return false;
    gameHistory = newHistory;
    if (latestId) currentSessionId = latestId;
    console.log(`📊 Lịch sử cập nhật: ${gameHistory.length} phiên, phiên cuối: ${currentSessionId}`);
    // Cập nhật bộ nhớ cầu
    for (let i = 0; i < gameHistory.length; i++) {
        updateCauMemory(gameHistory[i], gameHistory.slice(0, i+1));
    }
    return true;
}

// ========== 6. API ENDPOINTS ==========
app.get('/api/predict', async (req, res) => {
    try {
        const sessions = await fetchSessions();
        if (!updateHistoryFromSessions(sessions) || gameHistory.length === 0) {
            // Fallback cứng nếu vẫn rỗng
            gameHistory = ['Tài', 'Xỉu', 'Tài', 'Tài', 'Xỉu', 'Xỉu', 'Tài', 'Tài', 'Tài', 'Xỉu'];
            currentSessionId = 9999;
            console.log('📝 Dùng dữ liệu mặc định do không có từ API');
        }
        const md5Input = currentSessionId ? currentSessionId.toString() : Date.now().toString();
        const md5 = CryptoJS.MD5(md5Input).toString();
        const result = combinedPrediction(md5, gameHistory);
        const lastResult = gameHistory[gameHistory.length - 1];
        const nextSession = currentSessionId ? currentSessionId + 1 : 1;
        // Render HTML (giữ nguyên giao diện đẹp)
        const html = `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dự đoán Tài Xỉu</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;justify-content:center;align-items:center;padding:20px}
.container{background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:500px;width:100%;padding:30px;text-align:center}
h1{color:#333;margin-bottom:10px;font-size:24px}
.subtitle{color:#666;margin-bottom:30px;font-size:14px}
.info-card{background:#f8f9fa;border-radius:15px;padding:20px;margin-bottom:20px;text-align:left}
.info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e9ecef}
.info-row:last-child{border-bottom:none}
.info-label{font-weight:600;color:#495057}
.info-value{color:#212529;font-weight:500}
.prediction-box{background:linear-gradient(135deg,#667eea,#764ba2);border-radius:15px;padding:25px;margin-bottom:20px}
.prediction-label{color:rgba(255,255,255,0.9);font-size:14px;text-transform:uppercase;letter-spacing:2px}
.prediction-result{font-size:48px;font-weight:bold;color:#fff;margin:10px 0}
.confidence{color:rgba(255,255,255,0.9);font-size:18px}
.confidence-bar{background:rgba(255,255,255,0.3);border-radius:10px;height:8px;margin-top:15px;overflow:hidden}
.confidence-fill{background:#ffd700;height:100%;border-radius:10px;width:0%}
.refresh-btn{background:#28a745;color:#fff;border:none;padding:12px 30px;border-radius:25px;font-size:16px;cursor:pointer;margin-top:10px}
.refresh-btn:hover{background:#218838}
.footer{margin-top:20px;font-size:12px;color:#999}
.details{margin-top:20px;padding:15px;background:#f8f9fa;border-radius:10px;font-size:12px;color:#666;text-align:left}
</style>
</head>
<body>
<div class="container">
<h1>🎲 Hệ thống dự đoán Tài Xỉu</h1>
<div class="subtitle">Thuật toán MD5 + Bộ nhớ cầu + AI HTDD</div>
<div class="info-card">
<div class="info-row"><span class="info-label">ID:</span><span class="info-value">s2king</span></div>
<div class="info-row"><span class="info-label">Phiên:</span><span class="info-value">${currentSessionId || 'Đang tải...'}</span></div>
<div class="info-row"><span class="info-label">Kết quả:</span><span class="info-value">${lastResult}</span></div>
<div class="info-row"><span class="info-label">Xúc xắc:</span><span class="info-value">${lastResult !== 'Chưa có' ? (lastResult === 'Tài' ? '5-5-5' : '2-2-2') : '---'}</span></div>
<div class="info-row"><span class="info-label">Phiên hiện tại:</span><span class="info-value">${nextSession}</span></div>
</div>
<div class="prediction-box">
<div class="prediction-label">🔮 DỰ ĐOÁN</div>
<div class="prediction-result">${result.prediction === 'KHÔNG RÕ' ? '🤔 KHÔNG RÕ' : (result.prediction === 'Tài' ? '🎲 TÀI' : '⚫ XỈU')}</div>
<div class="confidence">Độ tin cậy: ${result.confidence}%</div>
<div class="confidence-bar"><div class="confidence-fill" style="width:${result.confidence}%"></div></div>
</div>
<button class="refresh-btn" onclick="location.reload()">⟳ Cập nhật dự đoán</button>
<div class="details">
<strong>Chi tiết thuật toán:</strong><br>
• MD5: ${result.details.md5.duDoan} (độ tin cậy ${result.details.md5.doTinCay}%)<br>
• Bộ nhớ cầu: ${result.details.cauMemory ? `${result.details.cauMemory.prediction} (${Math.round(result.details.cauMemory.confidence)}%)` : 'Không đủ dữ liệu'}<br>
• AI HTDD: ${result.details.file2.prediction} (độ tin cậy ${result.details.file2.confidence}%)<br>
• Lịch sử: ${gameHistory.length} phiên
</div>
<div class="footer">Hệ thống dự đoán kết hợp 3 thuật toán | Dữ liệu từ API Tele68 + fallback</div>
</div>
<script>setTimeout(()=>location.reload(),30000);</script>
</body>
</html>`;
        res.send(html);
    } catch (err) {
        console.error(err);
        res.status(500).send(`<h3>Lỗi: ${err.message}</h3><button onclick="location.reload()">Thử lại</button>`);
    }
});

app.get('/api/predict/json', async (req, res) => {
    try {
        const sessions = await fetchSessions();
        if (!updateHistoryFromSessions(sessions) || gameHistory.length === 0) {
            gameHistory = ['Tài', 'Xỉu', 'Tài', 'Tài', 'Xỉu'];
            currentSessionId = 1000;
        }
        const md5 = CryptoJS.MD5((currentSessionId || Date.now()).toString()).toString();
        const result = combinedPrediction(md5, gameHistory);
        res.json({
            success: true,
            data: {
                id: 's2king',
                phien_hien_tai: currentSessionId,
                phien_tiep_theo: currentSessionId ? currentSessionId + 1 : 1,
                ket_qua_cuoi: gameHistory[gameHistory.length - 1],
                du_doan: result.prediction,
                do_tin_cay: result.confidence,
                chi_tiet: result.details,
                tong_so_phien: gameHistory.length
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/', (req, res) => res.redirect('/api/predict'));

// Khởi động server
app.listen(PORT, async () => {
    console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
    const sessions = await fetchSessions();
    updateHistoryFromSessions(sessions);
    if (gameHistory.length === 0) {
        gameHistory = ['Tài', 'Xỉu', 'Tài', 'Tài', 'Xỉu', 'Xỉu', 'Tài'];
        currentSessionId = 5000;
        console.log('📝 Đã tạo dữ liệu mẫu');
    }
    console.log(`✅ Sẵn sàng với ${gameHistory.length} phiên lịch sử`);
});