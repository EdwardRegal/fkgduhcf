/**
 * Moshi Pro 解锁 —— Egern 脚本 (原生 ES module 写法)
 * ============================================================================
 * 目标: 让 Moshi (iOS, api.getmoshi.app) 认为当前设备持有 pro_lifetime 永久授权。
 *
 * 原理 (基于 main.jsbundle Hermes v98 反汇编还原的客户端逻辑):
 *   1. 客户端启动/进设置页时调用 GET /api/v1/licenses/me
 *      -> syncLicenseFromBackend -> getPrimaryLicense -> revalidateLicenseWithServer
 *   2. revalidateLicenseWithServer 只要 license.ownActivationId 存在且
 *      isLicenseUsableForClient(license) 为真, 就返回 {kind:'confirmed'}
 *   3. -> applyLicenseActivationToStore -> premiumStatusFromLicense(license)
 *   4. premiumStatusFromLicense: 只要 productKey !== 'pro_trial', 直接
 *      {isPremium:true, ...}; productKey === 'pro_lifetime' 时 isLifetime=true
 *      -> store.isPremium = true, isPremiumLifetime = true
 *
 *   所以本脚本只需要把 /licenses/me 的 licenses[] 换成一条伪造的 pro_lifetime
 *   授权即可。其余 license 相关端点一并改写, 保证任何 UI 路径都拿到一致结果。
 *
 * 用法: 见同目录 README.md (Egern 配置片段 + 安装步骤)
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// 伪造的身份常量 (固定不变, 避免被识别为 license churn)
// ---------------------------------------------------------------------------
const LICENSE_ID = '3f7a1c92-0b64-4d1e-9a83-5c2e7d401b55';
const ACTIVATION_ID = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const LICENSE_KEY = 'MOSHI-PRO1-LIFE-T1ME';
const PRODUCT_KEY = 'pro_lifetime'; // 客户端常量 LIFETIME_PRODUCT_KEY
const DEVICE_NAME = 'iPhone';

const API_HOST_RE = /^api\.getmoshi\.app$/i;

// ---------------------------------------------------------------------------
// 构造器
// ---------------------------------------------------------------------------
function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function buildLicense() {
  const t = nowSec();
  return {
    licenseId: LICENSE_ID,
    licenseKey: LICENSE_KEY,
    productKey: PRODUCT_KEY, // 非 'pro_trial' => premiumStatusFromLicense 直接 isPremium:true
    status: 'active', // isLicenseUsableForClient 走 effectiveStatus ?? status
    effectiveStatus: 'active',
    expiresAt: null, // 永久: expiryDate 为 null
    activationId: ACTIVATION_ID,
    ownActivationId: ACTIVATION_ID, // 必须存在, 否则 revalidate -> {kind:'revoked'}
    platform: 'ios',
    activatedAt: t,
    startsAt: t,
    deviceName: DEVICE_NAME,
    autoRenew: false, // pro_lifetime 时客户端 willAutoRenew 恒为 undefined
    isLifetime: true,
  };
}

function buildEntitlements() {
  // hasActiveEntitlement: status 为 active/grace 且 (expiresAt == null || 未过期)
  return [
    {
      productKey: PRODUCT_KEY,
      status: 'active',
      effectiveStatus: 'active',
      expiresAt: null,
    },
  ];
}

function buildActivation() {
  // 对应 POST /activate、/iap/redeem、/trials/request、/email/bind/confirm
  return { ok: true, activationId: ACTIVATION_ID, license: buildLicense() };
}

function buildDevices() {
  const t = nowSec();
  return {
    deviceCap: 99, // 绝不返回 409 device_cap_exceeded, 否则会弹设备上限 UI
    devices: [
      {
        activationId: ACTIVATION_ID,
        ownActivationId: ACTIVATION_ID,
        platform: 'ios',
        deviceName: DEVICE_NAME,
        activatedAt: t,
        lastSeenAt: t,
        isCurrent: true,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------
export default async function (ctx) {
  let url;
  try {
    url = new URL(ctx.request.url);
  } catch (e) {
    return; // 非法 URL -> 放行
  }

  if (!API_HOST_RE.test(url.hostname)) return; // 非 Moshi 后端 -> 放行

  const path = url.pathname.replace(/\/+$/, '') || '/';

  // --- 授权主接口: 客户端从这里读 licenses[] / entitlements[] --------------
  if (path === '/api/v1/licenses/me') {
    return ctx.respond({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: {
        licensePushFanoutEnabled: true,
        licenses: [buildLicense()],
        entitlements: buildEntitlements(),
      },
    });
  }

  // --- 激活 / 兑换 / 试用 / 邮箱绑定确认 ----------------------------------
  if (
    path === '/api/v1/licenses/activate' ||
    path === '/api/v1/licenses/iap/redeem' ||
    path === '/api/v1/licenses/email/bind/confirm' ||
    path === '/api/v1/trials/request'
  ) {
    // trials/request 也返回 pro_lifetime, 避免写入 30 天后过期的 pro_trial
    return ctx.respond({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: buildActivation(),
    });
  }

  // --- 邮件验证码 ---------------------------------------------------------
  if (path === '/api/v1/licenses/email/request' || path === '/api/v1/licenses/email/bind/request') {
    return ctx.respond({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: { ok: true, sent: true },
    });
  }

  // --- 解绑 (不真解绑) ----------------------------------------------------
  if (path === '/api/v1/licenses/deactivate') {
    return ctx.respond({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: { ok: true },
    });
  }

  // --- 设备列表 GET /licenses/{id}/devices -------------------------------
  if (/^\/api\/v1\/licenses\/[^/]+\/devices$/.test(path)) {
    return ctx.respond({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: buildDevices(),
    });
  }

  // --- push fanout 开关 ---------------------------------------------------
  if (/^\/api\/v1\/licenses\/[^/]+\/push-fanout$/.test(path)) {
    return ctx.respond({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: { ok: true, licensePushFanoutEnabled: true },
    });
  }

  return; // 其它一律放行
}
