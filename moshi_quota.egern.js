/**
 * Moshi 在线听写/账号配额解锁 —— Egern http_response 脚本
 * ============================================================================
 * 目标: 把 dictation/accounts 的配额响应改写为"额度充足"。
 *
 * 策略: 就地抬高已知数值字段, 保留原始响应结构 (对未知 shape 更稳)。
 *       若响应不是对象 (或解析失败), 回退为一个宽松的完整对象。
 *
 * 客户端状态对象 shape (反汇编 line 795457):
 *   {canTranscribeOnline, remainingSeconds, totalQuotaSeconds, quotaPeriodEnd,
 *    hasRegisteredToken, quotaStatus, quotaError, isQuotaLoaded}
 * 读取点: line 783188-783192 (totalQuotaSeconds, quotaPeriodEnd, quotaStatus)
 * ============================================================================
 */

const API_HOST_RE = /^api\.getmoshi\.app$/i;

const QUOTA_PATHS = new Set([
  '/api/v1/dictation/usage',
  '/api/v1/accounts/usage',
  '/api/v1/dictation/quota',
]);

const BIG = 999999999;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

const PATCH = {
  canTranscribeOnline: true,
  remainingSeconds: BIG,
  totalQuotaSeconds: BIG,
  quotaPeriodEnd: nowSec() + 30 * 24 * 3600,
  hasRegisteredToken: true,
  quotaStatus: 'ok',
  quotaError: null,
  isQuotaLoaded: true,
  remainingUses: BIG,
  remaining: BIG,
  limit: BIG,
  usage: 0,
  quota: BIG,
};

const FALLBACK = {
  canTranscribeOnline: true,
  remainingSeconds: BIG,
  totalQuotaSeconds: BIG,
  quotaPeriodEnd: nowSec() + 30 * 24 * 3600,
  hasRegisteredToken: true,
  quotaStatus: 'ok',
  quotaError: null,
  isQuotaLoaded: true,
  remainingUses: BIG,
};

export function patchQuota(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ...FALLBACK };

  for (const k of Object.keys(PATCH)) {
    if (k in obj) obj[k] = PATCH[k];
  }
  // 递归进一层: 常见 shape {accountsUsage:{...}, dictationUsage:{...}}
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (Array.isArray(v)) {
      for (const it of v) {
        if (it && typeof it === 'object') {
          for (const f of Object.keys(PATCH)) if (f in it) it[f] = PATCH[f];
        }
      }
    } else if (v && typeof v === 'object') {
      for (const f of Object.keys(PATCH)) if (f in v) v[f] = PATCH[f];
    }
  }
  return obj;
}

export default async function (ctx) {
  let url;
  try {
    url = new URL(ctx.request.url);
  } catch (e) {
    return;
  }
  if (!API_HOST_RE.test(url.hostname)) return;

  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!QUOTA_PATHS.has(path)) return;

  let data = null;
  try {
    data = await ctx.response.json();
  } catch (e) {
    data = null;
  }

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: patchQuota(data),
  };
}
