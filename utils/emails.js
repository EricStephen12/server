const axios = require('axios');

const FROM = 'Eixora <hello@eixora.store>';
const BASE = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html }) {
    if (!process.env.RESEND_API_KEY) {
        console.warn('[Email] RESEND_API_KEY not set, skipping email to', to);
        return;
    }
    try {
        await axios.post(BASE, { from: FROM, to, subject, html }, {
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`[Email] Sent "${subject}" to ${to}`);
    } catch (err) {
        console.error('[Email] Failed to send:', err.response?.data || err.message);
    }
}

// ── Welcome email — sent immediately on signup ────────────────────────────────
async function sendWelcomeEmail({ name, email }) {
    const firstName = name?.split(' ')[0] || 'Creator';
    await sendEmail({
        to: email,
        subject: `Welcome to Eixora, ${firstName} — here's your first move`,
        html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
            <div style="background: #0f172a; padding: 32px; border-radius: 16px 16px 0 0; text-align: center;">
                <h1 style="color: #84cc16; font-size: 28px; margin: 0; font-style: italic;">Eixora.</h1>
            </div>
            <div style="background: #ffffff; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 16px 16px;">
                <p style="font-size: 18px; font-weight: 700; color: #0f172a;">Hey ${firstName},</p>
                <p style="color: #475569; line-height: 1.6;">You just unlocked the same intel used by top-performing creators and media buyers. Here's how to get your first result in the next 2 minutes:</p>
                
                <div style="background: #f8fafc; border-left: 3px solid #84cc16; padding: 16px 20px; border-radius: 8px; margin: 24px 0;">
                    <p style="margin: 0; font-size: 14px; color: #334155;"><strong>Step 1:</strong> Go to your <a href="https://eixora.store/dashboard/analyze" style="color: #84cc16;">Creative Studio</a></p>
                    <p style="margin: 8px 0 0; font-size: 14px; color: #334155;"><strong>Step 2:</strong> Paste any viral TikTok or Reels URL</p>
                    <p style="margin: 8px 0 0; font-size: 14px; color: #334155;"><strong>Step 3:</strong> Watch the DNA extract in 60 seconds</p>
                </div>

                <p style="color: #475569; line-height: 1.6;">You have <strong>3 free scans</strong> to start. No credit card needed.</p>

                <a href="https://eixora.store/dashboard/analyze" style="display: inline-block; background: #0f172a; color: #ffffff; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 8px;">
                    Run My First Scan →
                </a>

                <p style="margin-top: 32px; color: #94a3b8; font-size: 12px;">Reply to this email if you have any questions — I read every message personally.<br><strong>Eric, Founder @ Eixora</strong></p>
            </div>
        </div>`
    });
}

// ── Day 7 upgrade nudge — sent when user is at 80%+ of scan limit ─────────────
async function sendUpgradeNudgeEmail({ name, email, scansUsed, scanLimit, plan }) {
    const firstName = name?.split(' ')[0] || 'Creator';
    await sendEmail({
        to: email,
        subject: `You've used ${scansUsed}/${scanLimit} scans this month`,
        html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
            <div style="background: #0f172a; padding: 32px; border-radius: 16px 16px 0 0; text-align: center;">
                <h1 style="color: #84cc16; font-size: 28px; margin: 0; font-style: italic;">Eixora.</h1>
            </div>
            <div style="background: #ffffff; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 16px 16px;">
                <p style="font-size: 18px; font-weight: 700; color: #0f172a;">Hey ${firstName},</p>
                <p style="color: #475569; line-height: 1.6;">You've used <strong>${scansUsed} of your ${scanLimit} monthly scans</strong>. You're clearly getting value out of Eixora.</p>
                <p style="color: #475569; line-height: 1.6;">Upgrade now before you hit the limit and lose momentum on your research.</p>

                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 12px; margin: 24px 0;">
                    <p style="margin: 0; font-weight: 700; color: #14532d;">Creator Plan — $9/mo</p>
                    <p style="margin: 4px 0 0; font-size: 14px; color: #166534;">30 scans/month · Max 5min video · Strategy Lounge Chat</p>
                </div>

                <a href="https://eixora.store/dashboard/upgrade" style="display: inline-block; background: #84cc16; color: #0f172a; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 800; font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em;">
                    Upgrade Now →
                </a>
            </div>
        </div>`
    });
}

module.exports = { sendWelcomeEmail, sendUpgradeNudgeEmail, sendEmail };
