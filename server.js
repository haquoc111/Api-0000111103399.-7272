const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=2cff2322cadccdcb7afd52aa2f828f83';

// =====================================================
// THUẬT TOÁN 1: DỰ ĐOÁN ĐỈNH CAO (MD5 / ObjectId)
// =====================================================
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
    if (lichSu15[i] === lichSu15[i - 1]) { lapHT++; if (lapHT > maxLap) maxLap = lapHT; }
    else { lapHT = 1; }
    if (i >= 2 && lichSu15[i] !== lichSu15[i - 1] && lichSu15[i - 1] !== lichSu15[i - 2]) cau11++;
    if (i >= 2 && lichSu15[i] === lichSu15[i - 2] && lichSu15[i] !== lichSu15[i - 1]) cauNgich++;
  }
  let last3 = lichSu15.slice(-3);
  let cauThuan = (last3[0] === last3[1] && last3[1] === last3[2]) ? 2 : (last3[0] === last3[1] || last3[1] === last3[2]) ? 1 : 0;
  let cauScore = 0;
  if (maxLap >= 4) cauScore = (lichSu15[lichSu15.length - 1] === 'T') ? 0.8 : -0.8;
  else if (cau11 >= 5) cauScore = (lichSu15[lichSu15.length - 1] === 'T') ? -0.7 : 0.7;
  else if (cauNgich >= 4) cauScore = (lichSu15[lichSu15.length - 1] === 'T') ? 0.6 : -0.6;
  else if (tiLeTai > 0.65) cauScore = -0.5;
  else if (tiLeTai < 0.35) cauScore = 0.5;
  else cauScore = (cauThuan === 2) ? 0.4 : (cauThuan === 1) ? 0.2 : 0;
  let finalScore = md5Score * 0.4 + cauScore * 0.6;
  let randomFactor = (bytes[8] % 100) / 100;
  let duDoan = '';
  let doTin = 0;
  if (Math.abs(finalScore) > 0.45) {
    duDoan = finalScore > 0 ? 'TAI' : 'XIU';
    doTin = 70 + Math.abs(finalScore) * 50;
  } else if (Math.abs(finalScore) > 0.2) {
    duDoan = finalScore > 0 ? 'TAI' : 'XIU';
    doTin = 55 + Math.abs(finalScore) * 40;
  } else {
    duDoan = randomFactor > 0.55 ? 'TAI' : 'XIU';
    doTin = 50 + Math.abs(randomFactor - 0.5) * 30;
  }
  if (maxLap >= 6) doTin = Math.min(96, doTin + 15);
  if (cau11 >= 8) doTin = Math.min(96, doTin + 12);
  if (tiLeTai > 0.8 || tiLeTai < 0.2) doTin = Math.min(96, doTin + 10);
  return { duDoan, doTinCay: Math.round(doTin), md5Score, cauScore };
}

// =====================================================
// THUẬT TOÁN 2: PREDICTION ALGORITHMS (từ predictionAlgorithmsAll.js)
// =====================================================
let modelPredictions = {};

function detectStreakAndBreak(history) {
  if (!history || history.length === 0) return { streak: 0, currentResult: null, breakProb: 0.0 };
  let streak = 1;
  const currentResult = history[history.length - 1].result;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].result === currentResult) streak++;
    else break;
  }
  const last20 = history.slice(-20).map(h => h.result);
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

function evaluateModelPerformance(history, modelName, lookback = 15) {
  if (!modelPredictions[modelName] || history.length < 2) return 1.0;
  lookback = Math.min(lookback, history.length - 1);
  let correctCount = 0;
  for (let i = 0; i < lookback; i++) {
    const pred = modelPredictions[modelName][history[history.length - (i + 2)].session] || 0;
    const actual = history[history.length - (i + 1)].result;
    if ((pred === 1 && actual === 'Tài') || (pred === 2 && actual === 'Xỉu')) correctCount++;
  }
  const performanceScore = lookback > 0 ? 1.0 + (correctCount - lookback / 2) / (lookback / 2) : 1.0;
  return Math.max(0.5, Math.min(1.5, performanceScore));
}

function trendAndProb(history) {
  if (!history || history.length < 3) return 0;
  const last10 = history.slice(-10).map(h => h.result);
  const taiCount = last10.filter(r => r === 'Tài').length;
  if (taiCount >= 7) return 1;
  if (taiCount <= 3) return 2;
  return last10[last10.length - 1] === 'Tài' ? 1 : 2;
}

function shortPattern(history) {
  if (!history || history.length < 4) return 0;
  const last4 = history.slice(-4).map(h => h.result);
  if (last4[2] === last4[3]) return last4[3] === 'Tài' ? 2 : 1;
  return last4[3] === 'Tài' ? 1 : 2;
}

function meanDeviation(history) {
  if (!history || history.length < 5) return 0;
  const lastScores = history.slice(-10).map(h => h.totalScore || 0);
  const avg = lastScores.reduce((s, v) => s + v, 0) / lastScores.length;
  return avg > 10.5 ? 1 : 2;
}

function recentSwitch(history) {
  if (!history || history.length < 3) return 0;
  const last6 = history.slice(-6).map(h => h.result);
  const switches = last6.slice(1).reduce((c, v, i) => c + (v !== last6[i] ? 1 : 0), 0);
  if (switches >= 4) return last6[last6.length - 1] === 'Tài' ? 2 : 1;
  return last6[last6.length - 1] === 'Tài' ? 1 : 2;
}

function smartBridgeBreak(history) {
  if (!history || history.length < 5) return { prediction: 0, breakProb: 0.0, reason: 'Không đủ dữ liệu' };
  const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
  const last30 = history.slice(-30).map(h => h.result);
  const lastScores = history.slice(-20).map(h => h.totalScore || 0);
  let breakProbability = breakProb;
  let reason = '';
  const avgScore = lastScores.reduce((sum, score) => sum + score, 0) / (lastScores.length || 1);
  const scoreDeviation = lastScores.reduce((sum, score) => sum + Math.abs(score - avgScore), 0) / (lastScores.length || 1);
  const last5 = last30.slice(-5);
  const patternCounts = {};
  for (let i = 0; i <= last30.length - 3; i++) {
    const pattern = last30.slice(i, i + 3).join(',');
    patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
  }
  const mostCommonPattern = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0];
  const isStablePattern = mostCommonPattern && mostCommonPattern[1] >= 4;
  if (streak >= 7) {
    breakProbability = Math.min(breakProbability + 0.15, 0.9);
    reason = `[Bẻ Cầu] Chuỗi ${streak} ${currentResult} dài`;
  } else if (streak >= 4 && scoreDeviation > 3.5) {
    breakProbability = Math.min(breakProbability + 0.1, 0.85);
    reason = `[Bẻ Cầu] Biến động điểm số lớn (${scoreDeviation.toFixed(1)})`;
  } else if (isStablePattern && last5.every(r => r === currentResult)) {
    breakProbability = Math.min(breakProbability + 0.05, 0.8);
    reason = `[Bẻ Cầu] Phát hiện mẫu lặp`;
  } else {
    breakProbability = Math.max(breakProbability - 0.15, 0.15);
    reason = `[Bẻ Cầu] Tiếp tục theo cầu`;
  }
  let prediction = breakProbability > 0.55 ? (currentResult === 'Tài' ? 2 : 1) : (currentResult === 'Tài' ? 1 : 2);
  return { prediction, breakProb: breakProbability, reason };
}

function isBadPattern(history) {
  if (!history || history.length < 5) return false;
  const last20 = history.slice(-20).map(h => h.result);
  const switches = last20.slice(1).reduce((count, curr, idx) => count + (curr !== last20[idx] ? 1 : 0), 0);
  const { streak } = detectStreakAndBreak(history);
  return switches >= 10 || streak >= 10;
}

function aiHtddLogic(history) {
  if (!history || history.length < 5) {
    const randomResult = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
    return { prediction: randomResult, reason: '[AI] Không đủ lịch sử, dự đoán ngẫu nhiên' };
  }
  const recentHistory = history.slice(-7).map(h => h.result);
  const recentScores = history.slice(-7).map(h => h.totalScore || 0);
  const taiCount = recentHistory.filter(r => r === 'Tài').length;
  const xiuCount = recentHistory.filter(r => r === 'Xỉu').length;
  if (history.length >= 5) {
    const last5 = history.slice(-5).map(h => h.result);
    if (last5.join(',') === 'Tài,Xỉu,Tài,Xỉu,Tài')
      return { prediction: 'Xỉu', reason: '[AI] Phát hiện mẫu 1T1X lặp → đánh Xỉu' };
    if (last5.join(',') === 'Xỉu,Tài,Xỉu,Tài,Xỉu')
      return { prediction: 'Tài', reason: '[AI] Phát hiện mẫu 1X1T lặp → đánh Tài' };
  }
  if (history.length >= 10 && history.slice(-7).every(h => h.result === 'Tài'))
    return { prediction: 'Xỉu', reason: '[AI] Chuỗi Tài 7 lần → dự đoán Xỉu' };
  if (history.length >= 10 && history.slice(-7).every(h => h.result === 'Xỉu'))
    return { prediction: 'Tài', reason: '[AI] Chuỗi Xỉu 7 lần → dự đoán Tài' };
  const avgScore = recentScores.reduce((sum, s) => sum + s, 0) / (recentScores.length || 1);
  if (avgScore > 10.5) return { prediction: 'Tài', reason: `[AI] Điểm TB cao (${avgScore.toFixed(1)}) → Tài` };
  if (avgScore < 7.5) return { prediction: 'Xỉu', reason: `[AI] Điểm TB thấp (${avgScore.toFixed(1)}) → Xỉu` };
  const overallTai = history.filter(h => h.result === 'Tài').length;
  const overallXiu = history.filter(h => h.result === 'Xỉu').length;
  if (Math.abs(overallTai - overallXiu) / history.length > 0.3) {
    return { prediction: overallTai > overallXiu ? 'Xỉu' : 'Tài', reason: '[AI] Cân bằng tổng thể' };
  }
  return { prediction: taiCount > xiuCount ? 'Xỉu' : 'Tài', reason: '[AI] Cân bằng gần đây' };
}

function generatePrediction(history) {
  if (!history || history.length === 0) return Math.random() < 0.5 ? 'Tài' : 'Xỉu';
  if (!modelPredictions['trend']) {
    modelPredictions = { trend: {}, short: {}, mean: {}, switch: {}, bridge: {} };
  }
  const currentIndex = history[history.length - 1].session;
  const trendPred = trendAndProb(history);
  const shortPred = shortPattern(history);
  const meanPred = meanDeviation(history);
  const switchPred = recentSwitch(history);
  const bridgePred = smartBridgeBreak(history);
  const aiPred = aiHtddLogic(history);
  modelPredictions['trend'][currentIndex] = trendPred;
  modelPredictions['short'][currentIndex] = shortPred;
  modelPredictions['mean'][currentIndex] = meanPred;
  modelPredictions['switch'][currentIndex] = switchPred;
  modelPredictions['bridge'][currentIndex] = bridgePred.prediction;
  const modelScores = {
    trend: evaluateModelPerformance(history, 'trend'),
    short: evaluateModelPerformance(history, 'short'),
    mean: evaluateModelPerformance(history, 'mean'),
    switch: evaluateModelPerformance(history, 'switch'),
    bridge: evaluateModelPerformance(history, 'bridge')
  };
  const weights = {
    trend: 0.2 * modelScores.trend,
    short: 0.2 * modelScores.short,
    mean: 0.25 * modelScores.mean,
    switch: 0.15 * modelScores.switch,
    bridge: 0.2 * modelScores.bridge,
    aihtdd: 0.2
  };
  let taiScore = 0, xiuScore = 0;
  if (trendPred === 1) taiScore += weights.trend; else if (trendPred === 2) xiuScore += weights.trend;
  if (shortPred === 1) taiScore += weights.short; else if (shortPred === 2) xiuScore += weights.short;
  if (meanPred === 1) taiScore += weights.mean; else if (meanPred === 2) xiuScore += weights.mean;
  if (switchPred === 1) taiScore += weights.switch; else if (switchPred === 2) xiuScore += weights.switch;
  if (bridgePred.prediction === 1) taiScore += weights.bridge; else if (bridgePred.prediction === 2) xiuScore += weights.bridge;
  if (aiPred.prediction === 'Tài') taiScore += weights.aihtdd; else xiuScore += weights.aihtdd;
  if (isBadPattern(history)) { taiScore *= 0.85; xiuScore *= 0.85; }
  const last10 = history.slice(-10).map(h => h.result);
  const taiPredCount = last10.filter(r => r === 'Tài').length;
  if (taiPredCount >= 7) xiuScore += 0.2;
  else if (taiPredCount <= 3) taiScore += 0.2;
  if (bridgePred.breakProb > 0.55) {
    if (bridgePred.prediction === 1) taiScore += 0.25; else xiuScore += 0.25;
  }
  return taiScore > xiuScore ? 'Xỉu' : 'Tài';
}

// =====================================================
// KẾT HỢP 3 THUẬT TOÁN → DỰ ĐOÁN CUỐI CÙNG
// =====================================================
function combinedPrediction(sessions) {
  if (!sessions || sessions.length < 2) {
    return { duDoan: 'TAI', doTinCay: 50, lyDo: 'Không đủ dữ liệu' };
  }

  // Lịch sử cho MD5
  const lichSu15 = sessions.slice(-15).map(s => s.resultTruyenThong === 'TAI' ? 'T' : 'X');
  const latestSession = sessions[0];
  // Dùng _id (ObjectId 24 hex) padding thành 32 ký tự hex cho thuật toán MD5
  const hexId = (latestSession._id + '00000000').substring(0, 32);
  const md5Result = duDoanDinhCao(hexId, lichSu15);

  // Lịch sử cho prediction algorithms
  const history = sessions.map(s => ({
    session: s.id,
    result: s.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    totalScore: s.point || 0
  })).reverse(); // API trả về mới nhất trước, đảo lại

  const algoPred = generatePrediction(history);

  // Bỏ phiếu: md5Result + algoPred
  const votes = { TAI: 0, XIU: 0 };
  if (md5Result.duDoan === 'TAI') votes.TAI += md5Result.doTinCay;
  else votes.XIU += md5Result.doTinCay;
  if (algoPred === 'Tài') votes.TAI += 60;
  else votes.XIU += 60;

  const winner = votes.TAI >= votes.XIU ? 'TAI' : 'XIU';
  const total = votes.TAI + votes.XIU;
  const confidence = Math.round((Math.max(votes.TAI, votes.XIU) / total) * 100);

  return {
    duDoan: winner,
    doTinCay: Math.min(confidence, 96),
    lyDo: `MD5=${md5Result.duDoan}(${md5Result.doTinCay}%) | Algo=${algoPred}`
  };
}

// =====================================================
// API ENDPOINT
// =====================================================
app.get('/predict', async (req, res) => {
  try {
    const response = await axios.get(API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://tele68.com/',
        'Origin': 'https://tele68.com'
      }
    });
    const sessions = response.data.list;

    if (!sessions || sessions.length === 0) {
      return res.status(500).json({ error: 'Không lấy được dữ liệu từ API' });
    }

    const latest = sessions[0];         // Phiên mới nhất (đã có kết quả)
    const nextSessionId = latest.id + 1; // Phiên hiện tại (chưa có kết quả)

    const { duDoan, doTinCay, lyDo } = combinedPrediction(sessions);

    const result = {
      id: 's2king',
      phien: latest.id,
      ket_qua: latest.resultTruyenThong === 'TAI' ? 'tài' : 'xỉu',
      xuc_xac: latest.dices.join('-'),
      phien_hien_tai: nextSessionId,
      du_doan: duDoan === 'TAI' ? 'tài' : 'xỉu',
      do_tin_cay: `${doTinCay}%`,
      ly_do: lyDo
    };

    console.log(`[${new Date().toISOString()}] Phiên ${latest.id} → Dự đoán phiên ${nextSessionId}: ${result.du_doan} (${result.do_tin_cay})`);
    res.json(result);
  } catch (err) {
    console.error('Lỗi:', err.message);
    res.status(500).json({ error: 'Server lỗi', detail: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Tài Xỉu Prediction Server - s2king',
    endpoint: '/predict'
  });
});

app.listen(PORT, () => {
  console.log(`Server s2king đang chạy tại port ${PORT}`);
});
