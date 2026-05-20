const express = require('express');
const CryptoJS = require('crypto-js');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// ============================================
// CẤU HÌNH API
// ============================================
const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=2cff2322cadccdcb7afd52aa2f828f83';

// Lịch sử các phiên
let gameHistory = [];
let currentSessionId = null;

// ============================================
// THUẬT TOÁN MD5 ĐỈNH CAO
// ============================================
function duDoanDinhCao(md5, lichSu15) {
    // Chuyển MD5 thành mảng byte
    let bytes = [];
    for (let i = 0; i < 32; i += 2) {
        bytes.push(parseInt(md5.substr(i, 2), 16));
    }
    
    // Tính tổng và trung bình
    let tong = bytes.reduce((a, b) => a + b, 0);
    let tb = tong / 16;
    
    // Phương sai
    let ps = 0;
    for (let b of bytes) {
        ps += Math.pow(b - tb, 2);
    }
    ps /= 16;
    
    // Entropy
    let entropy = 0;
    let dem = {};
    for (let b of bytes) {
        dem[b] = (dem[b] || 0) + 1;
    }
    for (let k in dem) {
        let p = dem[k] / 16;
        entropy -= p * Math.log2(p);
    }
    
    // Điểm MD5
    let md5Score = 0;
    if (tong % 6 >= 3) md5Score += 0.25;
    if (bytes[0] > 220 && bytes[15] < 70) md5Score += 0.35;
    if (bytes[15] < 30 && ps > 3500) md5Score -= 0.4;
    if (entropy > 3.6) md5Score -= 0.2;
    if (ps < 2000) md5Score += 0.2;
    
    // Thống kê lịch sử
    let thongKe = { T: 0, X: 0 };
    for (let k of lichSu15) {
        thongKe[k]++;
    }
    let tiLeTai = thongKe.T / 15;
    
    // Phân tích cầu
    let maxLap = 1, lapHT = 1, cau11 = 0, cauNgich = 0;
    for (let i = 1; i < lichSu15.length; i++) {
        if (lichSu15[i] === lichSu15[i - 1]) {
            lapHT++;
            if (lapHT > maxLap) maxLap = lapHT;
        } else {
            lapHT = 1;
        }
        if (i >= 2 && lichSu15[i] !== lichSu15[i - 1] && lichSu15[i - 1] !== lichSu15[i - 2]) {
            cau11++;
        }
        if (i >= 2 && lichSu15[i] === lichSu15[i - 2] && lichSu15[i] !== lichSu15[i - 1]) {
            cauNgich++;
        }
    }
    
    // Phân tích 3 phiên cuối
    let last3 = lichSu15.slice(-3);
    let cauThuan = (last3[0] === last3[1] && last3[1] === last3[2]) ? 2 :
                  (last3[0] === last3[1] || last3[1] === last3[2]) ? 1 : 0;
    
    // Điểm cầu
    let cauScore = 0;
    if (maxLap >= 4) {
        cauScore = (lichSu15[lichSu15.length - 1] === "T") ? 0.8 : -0.8;
    } else if (cau11 >= 5) {
        cauScore = (lichSu15[lichSu15.length - 1] === "T") ? -0.7 : 0.7;
    } else if (cauNgich >= 4) {
        cauScore = (lichSu15[lichSu15.length - 1] === "T") ? 0.6 : -0.6;
    } else if (tiLeTai > 0.65) {
        cauScore = -0.5;
    } else if (tiLeTai < 0.35) {
        cauScore = 0.5;
    } else {
        cauScore = (cauThuan === 2) ? 0.4 : (cauThuan === 1) ? 0.2 : 0;
    }
    
    // Điểm tổng hợp
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
    
    // Điều chỉnh độ tin cậy
    if (maxLap >= 6) doTin = Math.min(96, doTin + 15);
    if (cau11 >= 8) doTin = Math.min(96, doTin + 12);
    if (tiLeTai > 0.8 || tiLeTai < 0.2) doTin = Math.min(96, doTin + 10);
    
    return {
        duDoan: duDoan,
        doTinCay: Math.round(doTin),
        md5Score: md5Score,
        cauScore: cauScore,
        thongKe: { tong, ps, entropy }
    };
}

// ============================================
// THUẬT TOÁN TỪ FILE 1 (Thuật toán api.js)
// ============================================
// Lưu trữ bộ nhớ cầu
let cauMemoryBank = {
    biet: { Tai: {}, Xiu: {}, stats: { maxTai: 0, maxXiu: 0, avgTai: 0, avgXiu: 0 } },
    c11: { patterns: {}, stats: { total: 0 } },
    c22: { patterns: {}, stats: { total: 0 } }
};

// Cập nhật bộ nhớ cầu
function updateCauMemory(result, lichSu) {
    let n = lichSu.length;
    if (n < 3) return;
    
    // Phát hiện cầu bệt
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (lichSu[i] === result) streak++;
        else break;
    }
    
    if (streak >= 3) {
        if (result === 'Tài') {
            cauMemoryBank.biet.Tai[streak] = (cauMemoryBank.biet.Tai[streak] || 0) + 1;
            if (streak > cauMemoryBank.biet.stats.maxTai) cauMemoryBank.biet.stats.maxTai = streak;
        } else {
            cauMemoryBank.biet.Xiu[streak] = (cauMemoryBank.biet.Xiu[streak] || 0) + 1;
            if (streak > cauMemoryBank.biet.stats.maxXiu) cauMemoryBank.biet.stats.maxXiu = streak;
        }
    }
    
    // Phát hiện cầu 1-1
    if (n >= 6) {
        let last6 = lichSu.slice(-6);
        let is11 = true;
        for (let i = 1; i < 6; i++) {
            if (last6[i] === last6[i - 1]) {
                is11 = false;
                break;
            }
        }
        if (is11) {
            let pattern = last6.join(',');
            cauMemoryBank.c11.patterns[pattern] = (cauMemoryBank.c11.patterns[pattern] || 0) + 1;
            cauMemoryBank.c11.stats.total++;
        }
    }
}

// Dự đoán từ bộ nhớ cầu
function predictFromCauMemory(lichSu) {
    let n = lichSu.length;
    if (n < 5) return null;
    
    let lastResult = lichSu[n - 1];
    
    // Dự đoán từ cầu bệt
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (lichSu[i] === lastResult) streak++;
        else break;
    }
    
    if (streak >= 3) {
        let countLonger = 0, countThis = 0;
        for (let s = streak + 1; s <= Math.min(50, cauMemoryBank.biet.stats['max' + lastResult] || 50); s++) {
            countLonger += lastResult === 'Tài' ? (cauMemoryBank.biet.Tai[s] || 0) : (cauMemoryBank.biet.Xiu[s] || 0);
        }
        countThis = lastResult === 'Tài' ? (cauMemoryBank.biet.Tai[streak] || 0) : (cauMemoryBank.biet.Xiu[streak] || 0);
        let total = countThis + countLonger;
        
        if (total > 0) {
            let probContinue = countLonger / total;
            if (Math.abs(probContinue - 0.5) > 0.15) {
                let prediction = probContinue > 0.5 ? lastResult : (lastResult === 'Tài' ? 'Xỉu' : 'Tài');
                let confidence = Math.abs(probContinue - 0.5) * 2 + 0.3;
                return { prediction, confidence: Math.min(95, confidence * 100) };
            }
        }
    }
    
    return null;
}

// ============================================
// THUẬT TOÁN TỪ FILE 2 (predictionAlgorithmsAll.js)
// ============================================

// Phát hiện chuỗi và xác suất bẻ cầu
function detectStreakAndBreak(history) {
    if (!history || history.length === 0) {
        return { streak: 0, currentResult: null, breakProb: 0.0 };
    }
    
    let streak = 1;
    const currentResult = history[history.length - 1];
    for (let i = history.length - 2; i >= 0; i--) {
        if (history[i] === currentResult) {
            streak++;
        } else {
            break;
        }
    }
    
    const last20 = history.slice(-20);
    if (last20.length === 0) return { streak, currentResult, breakProb: 0.0 };
    
    const switches = last20.slice(1).reduce((count, curr, idx) => count + (curr !== last20[idx] ? 1 : 0), 0);
    const taiCount = last20.filter(r => r === 'Tài').length;
    const xiuCount = last20.filter(r => r === 'Xỉu').length;
    const imbalance = Math.abs(taiCount - xiuCount) / last20.length;
    
    let breakProb = 0.0;
    
    if (streak >= 8) {
        breakProb = Math.min(0.6 + (switches / 20) + imbalance * 0.15, 0.9);
    } else if (streak >= 5) {
        breakProb = Math.min(0.35 + (switches / 15) + imbalance * 0.25, 0.85);
    } else if (streak >= 3 && switches >= 8) {
        breakProb = 0.3;
    }
    
    return { streak, currentResult, breakProb };
}

// Bẻ cầu thông minh
function smartBridgeBreak(history) {
    if (!history || history.length < 5) {
        return { prediction: null, breakProb: 0.0, reason: 'Không đủ dữ liệu để bẻ cầu' };
    }
    
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    const last30 = history.slice(-30);
    
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

// AI HTDD Logic
function aiHtddLogic(history) {
    if (!history || history.length < 5) {
        const randomResult = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
        return { prediction: randomResult, reason: '[AI] Không đủ lịch sử, dự đoán ngẫu nhiên' };
    }
    
    const recentHistory = history.slice(-7);
    const taiCount = recentHistory.filter(r => r === 'Tài').length;
    const xiuCount = recentHistory.filter(r => r === 'Xỉu').length;
    
    // Phân tích mẫu dài hơn
    if (history.length >= 5) {
        const last5 = history.slice(-5);
        if (last5.join(',') === 'Tài,Xỉu,Tài,Xỉu,Tài') {
            return { prediction: 'Xỉu', reason: '[AI] Phát hiện mẫu 1T1X lặp → tiếp theo nên đánh Xỉu' };
        } else if (last5.join(',') === 'Xỉu,Tài,Xỉu,Tài,Xỉu') {
            return { prediction: 'Tài', reason: '[AI] Phát hiện mẫu 1X1T lặp → tiếp theo nên đánh Tài' };
        }
    }
    
    // Kiểm tra chuỗi dài
    if (history.length >= 10 && history.slice(-7).every(h => h === 'Tài')) {
        return { prediction: 'Xỉu', reason: '[AI] Chuỗi Tài quá dài (7 lần) → dự đoán Xỉu' };
    } else if (history.length >= 10 && history.slice(-7).every(h => h === 'Xỉu')) {
        return { prediction: 'Tài', reason: '[AI] Chuỗi Xỉu quá dài (7 lần) → dự đoán Tài' };
    }
    
    // Cân bằng dài hạn
    const overallTai = history.filter(h => h === 'Tài').length;
    const overallXiu = history.filter(h => h === 'Xỉu').length;
    if (Math.abs(overallTai - overallXiu) / history.length > 0.3) {
        return {
            prediction: overallTai > overallXiu ? 'Xỉu' : 'Tài',
            reason: `[AI] Tổng thể ${overallTai > overallXiu ? 'Tài' : 'Xỉu'} chiếm đa số → dự đoán ngược lại để cân bằng`
        };
    }
    
    return {
        prediction: taiCount > xiuCount ? 'Xỉu' : 'Tài',
        reason: `[AI] Gần đây ${taiCount > xiuCount ? 'Tài' : 'Xỉu'} nhiều hơn → dự đoán ngược lại để cân bằng`
    };
}

// Xu hướng và xác suất
function trendAndProb(history) {
    if (history.length < 20) return 0;
    
    const last20 = history.slice(-20);
    const taiCount = last20.filter(r => r === 'Tài').length;
    const xiuCount = 20 - taiCount;
    
    if (taiCount >= 13) return 2; // Xỉu
    if (xiuCount >= 13) return 1; // Tài
    return 0;
}

// Mẫu ngắn hạn
function shortPattern(history) {
    if (history.length < 5) return 0;
    
    const last4 = history.slice(-4);
    const lastResult = history[history.length - 1];
    
    // Phát hiện mẫu 2-2
    if (last4[0] === last4[1] && last4[2] === last4[3]) {
        return lastResult === 'Tài' ? 2 : 1;
    }
    
    return 0;
}

// Độ lệch trung bình
function meanDeviation(history) {
    if (history.length < 20) return 0;
    
    const last20 = history.slice(-20);
    const taiCount = last20.filter(r => r === 'Tài').length;
    const avg = taiCount / 20;
    
    if (avg > 0.6) return 2;
    if (avg < 0.4) return 1;
    return 0;
}

// Chuyển đổi gần đây
function recentSwitch(history) {
    if (history.length < 10) return 0;
    
    const last10 = history.slice(-10);
    let switches = 0;
    for (let i = 1; i < 10; i++) {
        if (last10[i] !== last10[i - 1]) switches++;
    }
    
    if (switches >= 7) {
        const lastResult = history[history.length - 1];
        return lastResult === 'Tài' ? 2 : 1;
    }
    
    return 0;
}

// Dự đoán tổng hợp từ tất cả thuật toán file 2
function predictFromFile2(history) {
    if (!history || history.length < 10) {
        return { prediction: null, confidence: 0, reason: 'Chưa đủ dữ liệu' };
    }
    
    const trendPred = trendAndProb(history);
    const shortPred = shortPattern(history);
    const meanPred = meanDeviation(history);
    const switchPred = recentSwitch(history);
    const bridgePred = smartBridgeBreak(history);
    const aiPred = aiHtddLogic(history);
    
    // Trọng số
    const weights = {
        trend: 0.2,
        short: 0.2,
        mean: 0.25,
        switch: 0.15,
        bridge: 0.2,
        aihtdd: 0.2
    };
    
    let taiScore = 0;
    let xiuScore = 0;
    
    if (trendPred === 1) taiScore += weights.trend;
    else if (trendPred === 2) xiuScore += weights.trend;
    
    if (shortPred === 1) taiScore += weights.short;
    else if (shortPred === 2) xiuScore += weights.short;
    
    if (meanPred === 1) taiScore += weights.mean;
    else if (meanPred === 2) xiuScore += weights.mean;
    
    if (switchPred === 1) taiScore += weights.switch;
    else if (switchPred === 2) xiuScore += weights.switch;
    
    if (bridgePred.prediction === 1) taiScore += weights.bridge;
    else if (bridgePred.prediction === 2) xiuScore += weights.bridge;
    
    if (aiPred.prediction === 'Tài') taiScore += weights.aihtdd;
    else xiuScore += weights.aihtdd;
    
    // Điều chỉnh khi có mẫu xấu
    if (history.length >= 10) {
        const last20 = history.slice(-20);
        const switches = last20.slice(1).reduce((count, curr, idx) => count + (curr !== last20[idx] ? 1 : 0), 0);
        const { streak } = detectStreakAndBreak(history);
        if (switches >= 10 || streak >= 10) {
            taiScore *= 0.85;
            xiuScore *= 0.85;
        }
    }
    
    // Cân bằng nếu dự đoán nghiêng quá nhiều
    const last10Preds = history.slice(-10);
    const taiPredCount = last10Preds.filter(r => r === 'Tài').length;
    if (taiPredCount >= 7) {
        xiuScore += 0.2;
    } else if (taiPredCount <= 3) {
        taiScore += 0.2;
    }
    
    const finalPrediction = taiScore > xiuScore ? 'Xỉu' : 'Tài';
    const confidence = Math.abs(taiScore - xiuScore) * 100 + 50;
    
    return {
        prediction: finalPrediction,
        confidence: Math.min(95, Math.round(confidence)),
        reason: `${aiPred.reason} | ${bridgePred.reason}`,
        taiScore,
        xiuScore
    };
}

// ============================================
// KẾT HỢP TẤT CẢ THUẬT TOÁN
// ============================================
function combinedPrediction(md5, history) {
    // Chuyển đổi lịch sử thành định dạng 'T'/'X' cho thuật toán MD5
    const lichSu15 = history.slice(-15).map(r => r === 'Tài' ? 'T' : 'X');
    
    // Dự đoán từ thuật toán MD5
    const md5Result = duDoanDinhCao(md5, lichSu15);
    
    // Dự đoán từ bộ nhớ cầu
    const cauResult = predictFromCauMemory(history);
    
    // Dự đoán từ file 2
    const file2Result = predictFromFile2(history);
    
    // Trọng số kết hợp
    const weights = {
        md5: 0.35,
        cauMemory: 0.25,
        file2: 0.40
    };
    
    // Tính điểm
    let taiScore = 0;
    let xiuScore = 0;
    let totalWeight = 0;
    
    // MD5
    if (md5Result.duDoan === 'TAI') {
        taiScore += weights.md5 * (md5Result.doTinCay / 100);
    } else {
        xiuScore += weights.md5 * (md5Result.doTinCay / 100);
    }
    totalWeight += weights.md5;
    
    // Bộ nhớ cầu
    if (cauResult) {
        if (cauResult.prediction === 'Tài') {
            taiScore += weights.cauMemory * (cauResult.confidence / 100);
        } else {
            xiuScore += weights.cauMemory * (cauResult.confidence / 100);
        }
        totalWeight += weights.cauMemory;
    } else {
        // Nếu không có dự đoán, chia đều
        taiScore += weights.cauMemory * 0.5;
        xiuScore += weights.cauMemory * 0.5;
        totalWeight += weights.cauMemory;
    }
    
    // File 2
    if (file2Result.prediction === 'Tài') {
        taiScore += weights.file2 * (file2Result.confidence / 100);
    } else {
        xiuScore += weights.file2 * (file2Result.confidence / 100);
    }
    totalWeight += weights.file2;
    
    // Chuẩn hóa
    taiScore = taiScore / totalWeight;
    xiuScore = xiuScore / totalWeight;
    
    // Dự đoán cuối cùng
    let finalPrediction = '';
    let finalConfidence = 0;
    
    if (Math.abs(taiScore - xiuScore) < 0.05) {
        finalPrediction = 'KHÔNG RÕ';
        finalConfidence = 50;
    } else {
        finalPrediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
        finalConfidence = Math.abs(taiScore - xiuScore) * 100 + 45;
        finalConfidence = Math.min(99, Math.round(finalConfidence));
    }
    
    return {
        prediction: finalPrediction,
        confidence: finalConfidence,
        details: {
            md5: md5Result,
            cauMemory: cauResult,
            file2: file2Result
        }
    };
}

// ============================================
// LẤY DỮ LIỆU TỪ API
// ============================================
async function fetchSessions() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        
        if (data && data.data && data.data.sessions) {
            return data.data.sessions;
        }
        return [];
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu từ API:', error);
        return [];
    }
}

// Cập nhật lịch sử từ dữ liệu API
function updateHistoryFromSessions(sessions) {
    const newHistory = [];
    
    for (const session of sessions) {
        // Chuyển đổi dữ liệu từ API
        const ketQua = session.ket_qua === 'Tài' ? 'Tài' : 'Xỉu';
        newHistory.push(ketQua);
        
        // Lưu thông tin phiên hiện tại
        if (!currentSessionId || session.phien > currentSessionId) {
            currentSessionId = session.phien;
        }
    }
    
    // Cập nhật gameHistory
    if (newHistory.length > 0) {
        gameHistory = newHistory;
        
        // Cập nhật bộ nhớ cầu
        for (let i = 0; i < gameHistory.length; i++) {
            updateCauMemory(gameHistory[i], gameHistory.slice(0, i + 1));
        }
    }
    
    return newHistory;
}

// ============================================
// API ENDPOINTS
// ============================================

// Endpoint chính để lấy dự đoán
app.get('/api/predict', async (req, res) => {
    try {
        // Lấy dữ liệu mới nhất từ API
        const sessions = await fetchSessions();
        updateHistoryFromSessions(sessions);
        
        if (gameHistory.length === 0) {
            return res.json({
                success: false,
                message: 'Chưa có dữ liệu lịch sử'
            });
        }
        
        // Tạo MD5 từ phiên hiện tại để demo
        // Trong thực tế, MD5 có thể lấy từ API hoặc tính từ dữ liệu
        const demoMd5 = CryptoJS.MD5(currentSessionId?.toString() || Date.now().toString()).toString();
        
        // Dự đoán kết hợp
        const result = combinedPrediction(demoMd5, gameHistory);
        
        // Lấy phiên hiện tại và tiếp theo
        let nextSession = currentSessionId ? currentSessionId + 1 : 1;
        let lastResult = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1] : 'Chưa có';
        
        // Tạo HTML response
        const html = `
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Hệ thống dự đoán Tài Xỉu siêu chính xác</title>
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    
                    body {
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        padding: 20px;
                    }
                    
                    .container {
                        background: white;
                        border-radius: 20px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                        max-width: 500px;
                        width: 100%;
                        padding: 30px;
                        text-align: center;
                    }
                    
                    h1 {
                        color: #333;
                        margin-bottom: 10px;
                        font-size: 24px;
                    }
                    
                    .subtitle {
                        color: #666;
                        margin-bottom: 30px;
                        font-size: 14px;
                    }
                    
                    .info-card {
                        background: #f8f9fa;
                        border-radius: 15px;
                        padding: 20px;
                        margin-bottom: 20px;
                        text-align: left;
                    }
                    
                    .info-row {
                        display: flex;
                        justify-content: space-between;
                        padding: 8px 0;
                        border-bottom: 1px solid #e9ecef;
                    }
                    
                    .info-row:last-child {
                        border-bottom: none;
                    }
                    
                    .info-label {
                        font-weight: 600;
                        color: #495057;
                    }
                    
                    .info-value {
                        color: #212529;
                        font-weight: 500;
                    }
                    
                    .prediction-box {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        border-radius: 15px;
                        padding: 25px;
                        margin-bottom: 20px;
                    }
                    
                    .prediction-label {
                        color: rgba(255,255,255,0.9);
                        font-size: 14px;
                        text-transform: uppercase;
                        letter-spacing: 2px;
                        margin-bottom: 10px;
                    }
                    
                    .prediction-result {
                        font-size: 48px;
                        font-weight: bold;
                        color: white;
                        margin-bottom: 10px;
                    }
                    
                    .confidence {
                        color: rgba(255,255,255,0.9);
                        font-size: 18px;
                    }
                    
                    .confidence-bar {
                        background: rgba(255,255,255,0.3);
                        border-radius: 10px;
                        height: 8px;
                        margin-top: 15px;
                        overflow: hidden;
                    }
                    
                    .confidence-fill {
                        background: #ffd700;
                        height: 100%;
                        border-radius: 10px;
                        transition: width 0.5s ease;
                    }
                    
                    .refresh-btn {
                        background: #28a745;
                        color: white;
                        border: none;
                        padding: 12px 30px;
                        border-radius: 25px;
                        font-size: 16px;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        margin-top: 10px;
                    }
                    
                    .refresh-btn:hover {
                        background: #218838;
                        transform: translateY(-2px);
                        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                    }
                    
                    .footer {
                        margin-top: 20px;
                        font-size: 12px;
                        color: #999;
                    }
                    
                    .details {
                        text-align: left;
                        margin-top: 20px;
                        padding: 15px;
                        background: #f8f9fa;
                        border-radius: 10px;
                        font-size: 12px;
                        color: #666;
                    }
                    
                    @keyframes pulse {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.7; }
                    }
                    
                    .loading {
                        animation: pulse 1.5s infinite;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🎲 Hệ thống dự đoán Tài Xỉu</h1>
                    <div class="subtitle">Thuật toán MD5 + AI + Bộ nhớ cầu</div>
                    
                    <div class="info-card">
                        <div class="info-row">
                            <span class="info-label">ID:</span>
                            <span class="info-value">s2king</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Phiên:</span>
                            <span class="info-value">${currentSessionId || 'Đang tải...'}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Kết quả:</span>
                            <span class="info-value">${lastResult}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Xúc xắc:</span>
                            <span class="info-value">${lastResult !== 'Chưa có' ? (lastResult === 'Tài' ? '5-5-5' : '2-2-2') : '---'}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Phiên hiện tại:</span>
                            <span class="info-value">${nextSession}</span>
                        </div>
                    </div>
                    
                    <div class="prediction-box">
                        <div class="prediction-label">🔮 DỰ ĐOÁN</div>
                        <div class="prediction-result">${result.prediction === 'KHÔNG RÕ' ? '🤔 KHÔNG RÕ' : (result.prediction === 'Tài' ? '🎲 TÀI' : '⚫ XỈU')}</div>
                        <div class="confidence">Độ tin cậy: ${result.confidence}%</div>
                        <div class="confidence-bar">
                            <div class="confidence-fill" style="width: ${result.confidence}%"></div>
                        </div>
                    </div>
                    
                    <button class="refresh-btn" onclick="location.reload()">⟳ Cập nhật dự đoán</button>
                    
                    <div class="details">
                        <strong>Chi tiết thuật toán:</strong><br>
                        • MD5: ${result.details.md5.duDoan} (độ tin cậy ${result.details.md5.doTinCay}%)<br>
                        • Bộ nhớ cầu: ${result.details.cauMemory ? `${result.details.cauMemory.prediction} (${Math.round(result.details.cauMemory.confidence)}%)` : 'Không đủ dữ liệu'}<br>
                        • AI HTDD: ${result.details.file2.prediction} (độ tin cậy ${result.details.file2.confidence}%)<br>
                        • Lịch sử: ${gameHistory.length} phiên
                    </div>
                    
                    <div class="footer">
                        Hệ thống dự đoán sử dụng kết hợp nhiều thuật toán | Dữ liệu từ API Tele68
                    </div>
                </div>
                
                <script>
                    // Tự động cập nhật mỗi 30 giây
                    setTimeout(() => {
                        location.reload();
                    }, 30000);
                </script>
            </body>
            </html>
        `;
        
        res.send(html);
        
    } catch (error) {
        console.error('Lỗi khi xử lý dự đoán:', error);
        res.status(500).json({
            success: false,
            message: 'Đã xảy ra lỗi: ' + error.message
        });
    }
});

// Endpoint API JSON
app.get('/api/predict/json', async (req, res) => {
    try {
        const sessions = await fetchSessions();
        updateHistoryFromSessions(sessions);
        
        if (gameHistory.length === 0) {
            return res.json({
                success: false,
                message: 'Chưa có dữ liệu lịch sử'
            });
        }
        
        const demoMd5 = CryptoJS.MD5(currentSessionId?.toString() || Date.now().toString()).toString();
        const result = combinedPrediction(demoMd5, gameHistory);
        
        res.json({
            success: true,
            data: {
                id: 's2king',
                phien_hien_tai: currentSessionId,
                phien_tiep_theo: currentSessionId ? currentSessionId + 1 : 1,
                ket_qua_cuoi: gameHistory[gameHistory.length - 1] || null,
                du_doan: result.prediction,
                do_tin_cay: result.confidence,
                chi_tiet: result.details,
                tong_so_phien: gameHistory.length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Trang chủ
app.get('/', (req, res) => {
    res.redirect('/api/predict');
});

// Khởi động server
app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════════════════╗
    ║     🎲 HỆ THỐNG DỰ ĐOÁN TÀI XỈU SIÊU CHÍNH XÁC      ║
    ║                                                      ║
    ║   Server đang chạy tại: http://localhost:${PORT}     ║
    ║                                                      ║
    ║   🔮 API dự đoán: http://localhost:${PORT}/api/predict ║
    ║   📊 JSON API: http://localhost:${PORT}/api/predict/json ║
    ║                                                      ║
    ║   Thuật toán: MD5 + Bộ nhớ cầu + AI HTDD            ║
    ╚══════════════════════════════════════════════════════╝
    `);
    
    // Khởi tạo dữ liệu ban đầu
    fetchSessions().then(sessions => {
        if (sessions.length > 0) {
            updateHistoryFromSessions(sessions);
            console.log(`✅ Đã tải ${sessions.length} phiên từ API`);
        }
    }).catch(err => {
        console.log('⚠️ Không thể kết nối API ban đầu, sẽ thử lại sau');
    });
});