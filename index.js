const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Api } = require('telegram/tl');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const express = require('express');
const chalk = require('chalk');

const API_ID = 23491254; // แทนที่ด้วย API_ID ของคุณ
const API_HASH = '5f21a8b3cd574ea9c96d1f1898932173'; // แทนที่ด้วย API_HASH ของคุณ
const ADMIN_ID = 7520172820; // แทนที่ด้วย Telegram ID ของแอดมิน
const DEFAULT_ADMIN_CODE = '0825658423zx'; // รหัสเริ่มต้นสำหรับแอดมิน
const DEFAULT_ADD_PHONE_CODE = '975699zx'; // รหัสเริ่มต้นสำหรับเพิ่มเบอร์

const clients = [];
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir);

const usedAngpaoFilePath = path.join(__dirname, 'used_angpao.json');
const phoneListFilePath = path.join(__dirname, 'phone_list.json');
const scanGroupsFilePath = path.join(__dirname, 'scan_groups.json');
const groupCountFilePath = path.join(__dirname, 'group_count.json');
const adminCodesFilePath = path.join(__dirname, 'admin_codes.json');
const expiredPhonesFilePath = path.join(__dirname, 'expired_phones.json');

let botLogs = [];
let apiStats = { totalLinksSent: 0, successfulLinks: 0, failedLinks: 0, lastError: null, lastErrorTime: null };
let totalGroupsJoined = 0;
let scanGroups = {};
let currentAdminCode = DEFAULT_ADMIN_CODE;
let currentAddPhoneCode = DEFAULT_ADD_PHONE_CODE;

const app = express();
const port = 4240;

app.use(express.json());
app.use(express.static('public'));

// File Management Functions
function loadOrCreateGroupCountFile() {
  if (!fs.existsSync(groupCountFilePath)) {
    fs.writeFileSync(groupCountFilePath, JSON.stringify({ total: 0 }, null, 2));
    console.log(chalk.bgGreen.black.bold(' 🌟 สร้างไฟล์ group_count.json อัตโนมัติ '));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌟 สร้างไฟล์ group_count.json อัตโนมัติ`, color: '#00ff00' });
  }
  const data = JSON.parse(fs.readFileSync(groupCountFilePath, 'utf8'));
  totalGroupsJoined = data.total || 0;
  return totalGroupsJoined;
}

function saveGroupCountFile() {
  fs.writeFileSync(groupCountFilePath, JSON.stringify({ total: totalGroupsJoined }, null, 2));
}

function loadOrCreateUsedAngpaoFile() {
  if (!fs.existsSync(usedAngpaoFilePath)) {
    fs.writeFileSync(usedAngpaoFilePath, JSON.stringify({}, null, 2));
    console.log(chalk.bgGreen.black.bold(' 🌟 สร้างไฟล์ used_angpao.json อัตโนมัติ '));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌟 สร้างไฟล์ used_angpao.json อัตโนมัติ`, color: '#00ff00' });
  }
  return JSON.parse(fs.readFileSync(usedAngpaoFilePath, 'utf8'));
}

function saveToUsedAngpaoFile(data) {
  fs.writeFileSync(usedAngpaoFilePath, JSON.stringify(data, null, 2));
}

function loadOrCreateExpiredPhonesFile() {
  if (!fs.existsSync(expiredPhonesFilePath)) {
    fs.writeFileSync(expiredPhonesFilePath, JSON.stringify([], null, 2));
    console.log(chalk.bgGreen.black.bold(' 🌟 สร้างไฟล์ expired_phones.json อัตโนมัติ '));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌟 สร้างไฟล์ expired_phones.json อัตโนมัติ`, color: '#00ff00' });
  }
  return JSON.parse(fs.readFileSync(expiredPhonesFilePath, 'utf8'));
}

function saveToExpiredPhonesFile(data) {
  fs.writeFileSync(expiredPhonesFilePath, JSON.stringify(data, null, 2));
}

function loadOrCreatePhoneListFile() {
  if (!fs.existsSync(phoneListFilePath)) {
    fs.writeFileSync(phoneListFilePath, JSON.stringify([], null, 2));
    console.log(chalk.bgGreen.black.bold(' 🌟 สร้างไฟล์ phone_list.json อัตโนมัติ (ว่างเปล่า) '));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌟 สร้างไฟล์ phone_list.json อัตโนมัติ (ว่างเปล่า)`, color: '#00ff00' });
  }
  let phoneList = JSON.parse(fs.readFileSync(phoneListFilePath, 'utf8'));
  let expiredPhones = loadOrCreateExpiredPhonesFile();
  const now = Date.now();
  
  phoneList = phoneList.filter(entry => {
    if (entry.expiresAt && entry.expiresAt < now) {
      console.log(chalk.bgRed.black.bold(` 🗑️ เบอร์ ${entry.number} หมดอายุแล้วและถูกลบ `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🗑️ เบอร์ ${entry.number} หมดอายุแล้วและถูกลบ`, color: '#ff5555' });
      expiredPhones.push({
        number: entry.number,
        name: entry.name,
        expiredAt: entry.expiresAt,
        deletedAt: now
      });
      return false;
    }
    return true;
  });
  
  saveToPhoneListFile(phoneList);
  saveToExpiredPhonesFile(expiredPhones);
  return phoneList;
}

function saveToPhoneListFile(data) {
  fs.writeFileSync(phoneListFilePath, JSON.stringify(data, null, 2));
}

function loadOrCreateScanGroupsFile() {
  if (!fs.existsSync(scanGroupsFilePath)) {
    fs.writeFileSync(scanGroupsFilePath, JSON.stringify({}, null, 2));
    console.log(chalk.bgGreen.black.bold(' 🌟 สร้างไฟล์ scan_groups.json อัตโนมัติ '));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌟 สร้างไฟล์ scan_groups.json อัตโนมัติ`, color: '#00ff00' });
  }
  scanGroups = JSON.parse(fs.readFileSync(scanGroupsFilePath, 'utf8'));
  const now = Date.now();
  for (const chatId in scanGroups) {
    if (scanGroups[chatId].expiresAt < now) {
      delete scanGroups[chatId];
      console.log(chalk.bgYellow.black.bold(` ⏰ การสแกนกลุ่ม ${chatId} หมดอายุแล้ว `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ⏰ การสแกนกลุ่ม ${chatId} หมดอายุแล้ว`, color: '#ffff00' });
    }
  }
  saveToScanGroupsFile(scanGroups);
  return scanGroups;
}

function saveToScanGroupsFile(data) {
  fs.writeFileSync(scanGroupsFilePath, JSON.stringify(data, null, 2));
}

function loadOrCreateAdminCodesFile() {
  if (!fs.existsSync(adminCodesFilePath)) {
    const defaultCodes = { adminCode: DEFAULT_ADMIN_CODE, addPhoneCode: DEFAULT_ADD_PHONE_CODE };
    fs.writeFileSync(adminCodesFilePath, JSON.stringify(defaultCodes, null, 2));
    console.log(chalk.bgGreen.black.bold(' 🌟 สร้างไฟล์ admin_codes.json อัตโนมัติด้วยรหัสเริ่มต้น '));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌟 สร้างไฟล์ admin_codes.json อัตโนมัติด้วยรหัสเริ่มต้น`, color: '#00ff00' });
  }
  const data = JSON.parse(fs.readFileSync(adminCodesFilePath, 'utf8'));
  currentAdminCode = data.adminCode || DEFAULT_ADMIN_CODE;
  currentAddPhoneCode = data.addPhoneCode || DEFAULT_ADD_PHONE_CODE;
}

function saveAdminCodesFile() {
  fs.writeFileSync(adminCodesFilePath, JSON.stringify({ adminCode: currentAdminCode, addPhoneCode: currentAddPhoneCode }, null, 2));
}

function calculatePhoneEarnings() {
  const usedAngpaoData = loadOrCreateUsedAngpaoFile();
  const earnings = {};
  for (const code in usedAngpaoData) {
    const entry = usedAngpaoData[code];
    if (entry && Array.isArray(entry.details)) {
      entry.details.forEach(detail => {
        if (detail && detail.mobile && detail.amount_baht) {
          const phone = detail.mobile;
          const amount = parseFloat(detail.amount_baht) || 0;
          earnings[phone] = (earnings[phone] || 0) + amount;
        }
      });
    }
  }
  return earnings;
}

async function reconnectClient(client, phone) {
  if (!client.connected) {
    console.log(chalk.bgYellow.black.bold(` ⚠️ บัญชี ${phone} หลุดการเชื่อมต่อ กำลังเชื่อมต่อใหม่... `));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ⚠️ บัญชี ${phone} หลุดการเชื่อมต่อ กำลังเชื่อมต่อใหม่`, color: '#ffff00' });
    try {
      await client.connect();
      console.log(chalk.bgGreen.black.bold(` 🌟 บัญชี ${phone} เชื่อมต่อใหม่สำเร็จ `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌟 บัญชี ${phone} เชื่อมต่อใหม่สำเร็จ`, color: '#00ff00' });
    } catch (error) {
      console.log(chalk.bgRed.black.bold(` ❌ ล้มเหลวในการเชื่อมต่อใหม่ ${phone}: ${error.message} `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ❌ ล้มเหลวในการเชื่อมต่อใหม่ ${phone}: ${error.message}`, color: '#ff5555' });
    }
  }
}

// Telegram Commands
async function handleAdmin(event, client) {
  const message = event.message;
  const userId = Number(message.senderId?.value || 0);
  const args = message.text.split(' ').slice(1);
  const phoneNumber = args[0];
  const code = args[1];
  const name = args.slice(2).join(' ');

  botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌌 คำสั่ง /admin จาก ${userId}: ${message.text}`, color: '#00ffcc' });

  if (userId !== ADMIN_ID) {
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ⚠️ ไม่ใช่แอดมิน - ${userId}`, color: '#ff5555' });
    await client.sendMessage(message.chatId, { message: '🚀 เฉพาะแอดมินเท่านั้นที่ใช้คำสั่งนี้ได้!' });
    return;
  }
  if (!phoneNumber || !code || !name) {
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ⚠️ ขาดเบอร์ รหัส หรือชื่อ โดย ${userId}`, color: '#ff5555' });
    await client.sendMessage(message.chatId, { message: '🌠 กรุณาใส่เบอร์โทร รหัส 8 หลัก และชื่อ เช่น /admin 0987654321 975699zx นายแดง' });
    return;
  }

  if (code !== currentAddPhoneCode) {
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ⚠️ รหัสไม่ถูกต้อง ${code} โดย ${userId}`, color: '#ff5555' });
    await client.sendMessage(message.chatId, { message: '🌌 รหัส 8 หลักไม่ถูกต้อง!' });
    return;
  }

  const phoneRegex = /^0\d{9}$/;
  if (!phoneRegex.test(phoneNumber)) {
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ⚠️ เบอร์ไม่ถูกต้อง ${phoneNumber} โดย ${userId}`, color: '#ff5555' });
    await client.sendMessage(message.chatId, { message: '🌌 เบอร์ต้องมี 10 หลักและขึ้นต้นด้วย 0 นะคะ!' });
    return;
  }

  const phoneList = loadOrCreatePhoneListFile();
  if (phoneList.some(entry => entry.number === phoneNumber)) {
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ⚠️ เบอร์ซ้ำ ${phoneNumber} โดย ${userId}`, color: '#ff5555' });
    await client.sendMessage(message.chatId, { message: '🌙 เบอร์นี้มีอยู่ในระบบแล้วค่ะ!' });
    return;
  }

  phoneList.push({ number: phoneNumber, name });
  saveToPhoneListFile(phoneList);
  console.log(chalk.bgMagenta.black.bold(` 🎉 เพิ่มเบอร์ ${phoneNumber} ชื่อ ${name} โดยแอดมิน ${userId} `));
  botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🎉 เพิ่มเบอร์ ${phoneNumber} ชื่อ ${name} โดย ${userId}`, color: '#00ff00' });
  await client.sendMessage(message.chatId, { message: `🌟 เพิ่มเบอร์ ${phoneNumber} ชื่อ ${name} สำเร็จแล้วค่ะ!` });
}

async function handleScanAngpao(event, client) {
  const message = event.message;
  const userId = Number(message.senderId?.value || 0);
  const chatId = String(message.chatId?.value || '');

  botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌌 คำสั่ง /scanangpao จาก ${userId} ใน ${chatId}`, color: '#00ffcc' });

  if (userId !== ADMIN_ID) {
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ⚠️ ไม่ใช่แอดมิน - ${userId}`, color: '#ff5555' });
    await client.sendMessage(message.chatId, { message: '🚀 เฉพาะแอดมินเท่านั้นที่ใช้คำสั่งนี้ได้!' });
    return;
  }

  const chat = await client.getEntity(message.chatId);
  if (!chat.group && !chat.supergroup) {
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ⚠️ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น`, color: '#ff5555' });
    await client.sendMessage(message.chatId, { message: '🌌 คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้นค่ะ!' });
    return;
  }

  loadOrCreateScanGroupsFile();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  scanGroups[chatId] = { expiresAt };
  saveToScanGroupsFile(scanGroups);

  console.log(chalk.bgGreen.black.bold(` 🌟 เปิดการสแกนอั่งเปาในกลุ่ม ${chatId} เรียบร้อยแล้ว `));
  botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌟 เปิดการสแกนอั่งเปาในกลุ่ม ${chatId} ถึง ${new Date(expiresAt).toLocaleString('th-TH')}`, color: '#00ff00' });
  await client.sendMessage(message.chatId, { message: '* คือพร้อมใช้แล้ว' });
}

async function handleNewMessage(event, client) {
  const botIndex = clients.indexOf(client) + 1;
  const botLabel = `[บอทตัวที่ ${botIndex}]`;
  const message = event.message;
  if (!message || !message.chatId || !message.senderId) return;

  const chatId = String(message.chatId.value || '');
  const userId = Number(message.senderId.value || 0);
  const text = message.text || '';

  try {
    const chat = await client.getEntity(message.chatId);
    const chatType = chat.group || chat.supergroup ? 'กลุ่ม' : 'ส่วนตัว';

    console.log(chalk.bgCyan.black.bold(` ${botLabel} 🌌 รับข้อความจาก ${chatType} ${chatId} - ${userId}: ${text} `));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 📩 รับข้อความจาก ${chatType} ${chatId} - ${userId}: ${text}`, color: '#00ffcc' });

    loadOrCreateScanGroupsFile();
    const now = Date.now();

    // การจัดการลิงก์เชิญ
    const inviteLinkRegex = /(?:https?:\/\/)?t\.me\/(?:joinchat\/|\+)?([a-zA-Z0-9_-]+)/i;
    const inviteMatch = text.match(inviteLinkRegex);
    if (inviteMatch) {
      const inviteCode = inviteMatch[1];
      console.log(chalk.bgYellow.black.bold(` ${botLabel} 🌠 พบลิงก์เชิญ: ${inviteMatch[0]} (รหัส: ${inviteCode})`));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 🌠 พบลิงก์เชิญ: ${inviteMatch[0]}`, color: '#ffff00' });
      try {
        const joinResult = await client.invoke(new Api.messages.ImportChatInvite({ hash: inviteCode }));
        const newChatId = String(joinResult.chats[0].id.value);
        totalGroupsJoined++;
        saveGroupCountFile();
        console.log(chalk.bgGreen.black.bold(` ${botLabel} 🌟 เข้าร่วมกลุ่มใหม่ ${newChatId} สำเร็จ (กลุ่มที่ ${totalGroupsJoined})`));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 🌟 เข้าร่วมกลุ่มใหม่ ${newChatId} สำเร็จ (กลุ่มที่ ${totalGroupsJoined})`, color: '#00ff00' });
        const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
        scanGroups[newChatId] = { expiresAt };
        saveToScanGroupsFile(scanGroups);
      } catch (joinError) {
        console.log(chalk.bgRed.black.bold(` ${botLabel} ❌ ล้มเหลวในการเข้าร่วมกลุ่ม: ${joinError.message}`));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ❌ ล้มเหลวในการเข้าร่วมกลุ่ม: ${joinError.message}`, color: '#ff5555' });
      }
    }

    // การส่งต่อรูปภาพ
    if (message.media && message.media.className === 'MessageMediaPhoto') {
      console.log(chalk.bgYellow.black.bold(` ${botLabel} 🖼️ พบภาพใน ${chatType} ${chatId} `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 🖼️ พบภาพใน ${chatType} ${chatId}`, color: '#ffff00' });
      try {
        await client.forwardMessages('@E771VIPCHNM_BOT', { messages: message.id, fromPeer: message.chatId });
        console.log(chalk.bgGreen.black.bold(` ${botLabel} 📤 ส่งต่อภาพไปยัง @E771VIPCHNM_BOT สำเร็จ `));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 📤 ส่งต่อภาพไปยัง @E771VIPCHNM_BOT สำเร็จ`, color: '#00ff00' });
      } catch (error) {
        console.log(chalk.bgRed.black.bold(` ${botLabel} ❌ ล้มเหลวในการส่งต่อภาพไปยัง @E771VIPCHNM_BOT: ${error.message} `));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ❌ ล้มเหลวในการส่งต่อภาพ: ${error.message}`, color: '#ff5555' });
      }
    }

    // การจัดการอั่งเปา TrueMoney
    if (chatType === 'ส่วนตัว' || (scanGroups[chatId] && scanGroups[chatId].expiresAt > now)) {
      const regex = /https:\/\/gift\.truemoney\.com\/campaign\/\?v=([a-zA-Z0-9]+)/;
      const matchResult = text.match(regex);

      if (!matchResult || !matchResult[0]) {
        console.log(chalk.bgRed.black.bold(` ${botLabel} ⚠️ ไม่พบลิงก์ TrueMoney Gift ที่ตรงเงื่อนไขในข้อความ: ${text} `));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ⚠️ ไม่พบลิงก์ TrueMoney Gift ที่ตรงเงื่อนไขในข้อความ: ${text}`, color: '#ff5555' });
        return;
      }

      const angpaoLink = matchResult[0];
      const angpaoCode = matchResult[1];

      // ตรวจสอบลิงก์ว่ามีอยู่ในระบบหรือไม่
      try {
        const existingLinksResponse = await fetch('http://de01.uniplex.xyz:1636/api/data/telegram');
        const existingLinks = await existingLinksResponse.json();
        const isLinkExist = existingLinks.some(item => item.link === angpaoLink);
        if (isLinkExist) {
          console.log(chalk.bgYellow.black.bold(` ${botLabel} ⚠️ ลิงก์ ${angpaoLink} มีอยู่ในระบบแล้ว ข้ามการบันทึก `));
          botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ⚠️ ลิงก์ ${angpaoLink} มีอยู่ในระบบแล้ว ข้ามการบันทึก`, color: '#ffff00' });
        } else {
          const saveResponse = await fetch('http://de01.uniplex.xyz:1636/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link: angpaoLink, source: 'telegram' })
          });
          const saveData = await saveResponse.json();
          console.log(chalk.bgGreen.black.bold(` ${botLabel} 📜 บันทึก URL ${angpaoLink} สำเร็จ: ${JSON.stringify(saveData)} `));
          botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 📜 บันทึก URL ${angpaoLink} สำเร็จ`, color: '#00ff00' });
        }
      } catch (saveError) {
        console.log(chalk.bgRed.black.bold(` ${botLabel} ❌ ล้มเหลวในการตรวจสอบ/บันทึก URL ${angpaoLink}: ${saveError.message} `));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ❌ ล้มเหลวในการตรวจสอบ/บันทึก URL ${angpaoLink}: ${saveError.message}`, color: '#ff5555' });
      }

      let usedAngpaoData = loadOrCreateUsedAngpaoFile();
      const phoneList = loadOrCreatePhoneListFile();
      const specialPhone = '';
      const allPhones = [{ number: specialPhone, name: 'บัญชีพิเศษ' }, ...phoneList];

      if (allPhones.length === 0) {
        console.log(chalk.bgRed.black.bold(` ${botLabel} ⚠️ ไม่มีเบอร์ในระบบ ไม่สามารถเติมเงินได้ `));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ⚠️ ไม่มีเบอร์ในระบบ ไม่สามารถเติมเงินได้`, color: '#ff5555' });
        return;
      }

      console.log(chalk.bgYellow.black.bold(` ${botLabel} 📞 พบ ${allPhones.length} เบอร์ (รวมเบอร์พิเศษ) `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 📞 พบ ${allPhones.length} เบอร์ (รวมเบอร์พิเศษ)`, color: '#ffff00' });

      // ฟังก์ชันเติมเงินที่ปรับปรุงให้มีระบบลองใหม่
      const redeemAngpao = async (phoneEntry, attempt = 1, maxAttempts = 3) => {
        const paymentPhone = phoneEntry.number;
        const apiUrl = `https://store.cyber-safe.pro/api/topup/truemoney/angpaofree/${angpaoCode}/${paymentPhone}`;

        console.log(chalk.bgCyan.black.bold(` ${botLabel} 🌐 เรียก API: ${apiUrl} (ครั้งที่ ${attempt}) `));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 🌐 เรียก API: ${apiUrl} (ครั้งที่ ${attempt})`, color: '#00ffcc' });

        apiStats.totalLinksSent++;

        try {
          const response = await axios.get(apiUrl, { timeout: 10000 });
          const responseData = response.data;

          console.log(chalk.bgYellow.black.bold(` ${botLabel} 📩 ได้รับการตอบกลับ: ${JSON.stringify(responseData)} `));
          botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 📩 ได้รับการตอบกลับ: ${JSON.stringify(responseData)}`, color: '#ffff00' });

          if (response.status === 200 && responseData.status.code === "SUCCESS") {
            apiStats.successfulLinks++;
            const amount = parseFloat(responseData.data.my_ticket?.amount_baht || responseData.data.voucher.amount_baht);
            const detail = {
              mobile: paymentPhone,
              update_date: Date.now(),
              amount_baht: amount.toFixed(2),
              full_name: responseData.data.owner_profile?.full_name || "ไม่ระบุ"
            };

            if (!usedAngpaoData[angpaoCode]) {
              usedAngpaoData[angpaoCode] = { details: [], chatId: chatId, usedAt: new Date().toISOString(), totalAmount: responseData.data.voucher.amount_baht };
            }

            const existingDetailIndex = usedAngpaoData[angpaoCode].details.findIndex(d => d.mobile === paymentPhone);
            if (existingDetailIndex !== -1) {
              const existingAmount = parseFloat(usedAngpaoData[angpaoCode].details[existingDetailIndex].amount_baht) || 0;
              usedAngpaoData[angpaoCode].details[existingDetailIndex].amount_baht = (existingAmount + amount).toFixed(2);
              usedAngpaoData[angpaoCode].details[existingDetailIndex].update_date = Date.now();
            } else {
              usedAngpaoData[angpaoCode].details.push(detail);
            }

            if (paymentPhone !== specialPhone) {
              saveToUsedAngpaoFile(usedAngpaoData);
            }

            console.log(
              chalk.bgGreen.black.bold(` ${botLabel} 💰 เติมสำเร็จ! `) +
              chalk.cyan(` ซอง: ${angpaoCode} `) +
              chalk.green(` จำนวน: ${amount} บาท `) +
              chalk.magenta(` เบอร์: ${paymentPhone} `) +
              chalk.gray(`[${new Date().toLocaleTimeString()}]`)
            );
            botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 💰 เติมสำเร็จ ${angpaoCode} -> ${paymentPhone} ${amount} บาท`, color: '#00ff00' });
            return { success: true, phone: paymentPhone, amount };
          } else {
            throw new Error(`สถานะ API: ${responseData.status.code}`);
          }
        } catch (error) {
          apiStats.failedLinks++;
          apiStats.lastError = error.message;
          apiStats.lastErrorTime = new Date().toISOString();

          if (attempt < maxAttempts) {
            console.log(chalk.bgYellow.black.bold(` ${botLabel} ⚠️ ลองใหม่ครั้งที่ ${attempt + 1} สำหรับ ${paymentPhone} `));
            botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ⚠️ ลองใหม่ครั้งที่ ${attempt + 1} สำหรับ ${paymentPhone}`, color: '#ffff00' });
            await new Promise(resolve => setTimeout(resolve, 500));
            return redeemAngpao(phoneEntry, attempt + 1, maxAttempts);
          }

          console.log(
            chalk.bgRed.black.bold(` ${botLabel} ⚠️ เติมล้มเหลว `) +
            chalk.cyan(` ซอง: ${angpaoCode} `) +
            chalk.magenta(` เบอร์: ${paymentPhone} `) +
            chalk.red(` เหตุผล: ${error.message} `) +
            chalk.gray(`[${new Date().toLocaleTimeString()}]`)
          );
          botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ⚠️ เติมล้มเหลว ${angpaoCode} -> ${paymentPhone}: ${error.message}`, color: '#ff5555' });
          return { success: false, phone: paymentPhone, error: error.message };
        }
      };

      // ประมวลผลเบอร์เป็นชุด ชุดละ 3 เบอร์
      console.log(chalk.bgCyan.black.bold(` ${botLabel} 🌌 เริ่มดักซอง ${angpaoCode} จาก ${chatType} ${chatId} `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 🌌 เริ่มดักซอง ${angpaoCode} จาก ${chatType === 'ส่วนตัว' ? 'แชทส่วนตัว' : 'กลุ่ม'} ${chatId}`, color: '#00ffcc' });

      const batchSize = 3;
      const redemptionPromises = [];

      for (let i = 0; i < allPhones.length; i += batchSize) {
        const batch = allPhones.slice(i, i + batchSize);
        const batchPromises = batch.map(phoneEntry => redeemAngpao(phoneEntry));
        redemptionPromises.push(Promise.all(batchPromises));
      }

      // รันชุดคำสั่งแบบเรียงลำดับ แต่ในแต่ละชุดทำงานพร้อมกัน
      for (const batchPromise of redemptionPromises) {
        await batchPromise; // รอให้แต่ละชุด 3 เบอร์เสร็จก่อนเริ่มชุดถัดไป
      }

      console.log(chalk.bgGreen.black.bold(` ${botLabel} ✅ การดักซอง ${angpaoCode} เสร็จสิ้น `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ✅ การดักซอง ${angpaoCode} เสร็จสิ้น`, color: '#00ff00' });
    } else {
      console.log(chalk.bgYellow.black.bold(` ${botLabel} ⚠️ กลุ่ม ${chatId} ไม่ได้เปิดการสแกนอั่งเปา หรือหมดอายุแล้ว `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ⚠️ กลุ่ม ${chatId} ไม่ได้เปิดการสแกนอั่งเปา หรือหมดอายุแล้ว`, color: '#ff5555' });
    }
  } catch (error) {
    console.log(chalk.bgRed.black.bold(` ${botLabel} ❌ ข้อผิดพลาดใน handleNewMessage: ${error.message} `));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ❌ ข้อผิดพลาดใน handleNewMessage: ${error.message}`, color: '#ff5555' });
    await reconnectClient(client, client.phone);
  }
}

// Web API Endpoints
app.get('/api/admin-codes', (req, res) => {
  res.json({ adminCode: currentAdminCode, addPhoneCode: currentAddPhoneCode });
});

app.post('/api/update-admin-codes', (req, res) => {
  const { adminCode, addPhoneCode, authCode } = req.body;

  if (authCode !== currentAdminCode) {
    return res.status(401).json({ error: 'รหัสแอดมินไม่ถูกต้อง' });
  }

  if (adminCode && typeof adminCode === 'string' && adminCode.length >= 8) {
    currentAdminCode = adminCode;
    console.log(chalk.bgYellow.black.bold(` ✏️ เปลี่ยนรหัสแอดมินเป็น ${currentAdminCode} ผ่านเว็บ `));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ✏️ เปลี่ยนรหัสแอดมินเป็น ${currentAdminCode} ผ่านเว็บ`, color: '#ffff00' });
  }
  if (addPhoneCode && typeof addPhoneCode === 'string' && addPhoneCode.length >= 8) {
    currentAddPhoneCode = addPhoneCode;
    console.log(chalk.bgYellow.black.bold(` ✏️ เปลี่ยนรหัสเพิ่มเบอร์เป็น ${currentAddPhoneCode} ผ่านเว็บ `));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ✏️ เปลี่ยนรหัสเพิ่มเบอร์เป็น ${currentAddPhoneCode} ผ่านเว็บ`, color: '#ffff00' });
  }

  saveAdminCodesFile();
  res.json({ message: 'อัปเดตรหัสสำเร็จ', adminCode: currentAdminCode, addPhoneCode: currentAddPhoneCode });
});

app.get('/api/phone-details', (req, res) => {
  const usedAngpaoData = loadOrCreateUsedAngpaoFile();
  const phoneList = loadOrCreatePhoneListFile();
  const specialPhone = '';
  const details = {};
  for (const code in usedAngpaoData) {
    const entry = usedAngpaoData[code];
    if (entry && Array.isArray(entry.details)) {
      entry.details.forEach(detail => {
        if (detail && detail.mobile && detail.mobile !== specialPhone) {
          const phone = detail.mobile;
          const phoneEntry = phoneList.find(p => p.number === phone);
          if (!details[phone]) details[phone] = [];
          details[phone].push({
            rank: phoneList.findIndex(p => p.number === phone) + 1,
            angpaoCode: code,
            mobile: detail.mobile,
            update_date: detail.update_date,
            amount_baht: detail.amount_baht || "0.00",
            totalAmount: entry.totalAmount || "0.00",
            name: phoneEntry ? phoneEntry.name : "ไม่ระบุ"
          });
        }
      });
    }
  }
  res.json(details);
});

app.get('/api/phones', (req, res) => {
  const phoneList = loadOrCreatePhoneListFile();
  const earnings = calculatePhoneEarnings();
  const specialPhone = '';
  const phoneData = phoneList
    .filter(entry => entry.number !== specialPhone)
    .map((entry, index) => ({
      rank: index + 1,
      number: entry.number,
      name: entry.name,
      earnings: earnings[entry.number] || 0,
      expiresAt: entry.expiresAt || null
    }));
  res.json(phoneData);
});

app.get('/api/expired-phones', (req, res) => {
  const expiredPhones = loadOrCreateExpiredPhonesFile();
  const formattedData = expiredPhones.map((entry, index) => ({
    rank: index + 1,
    number: entry.number,
    name: entry.name,
    expiredAt: entry.expiredAt ? new Date(entry.expiredAt).toLocaleString('th-TH') : 'ไม่ระบุ',
    deletedAt: entry.deletedAt ? new Date(entry.deletedAt).toLocaleString('th-TH') : 'ไม่ระบุ'
  }));
  res.json(formattedData);
});

app.post('/api/add-phone', (req, res) => {
  const { phone, code, name, expiresAt } = req.body;
  const phoneRegex = /^0\d{9}$/;

  if (!phone || !code || !name || !expiresAt) return res.status(400).json({ error: 'กรุณาใส่เบอร์ รหัส 8 หลัก ชื่อ และวันหมดอายุ' });
  if (code !== currentAddPhoneCode) return res.status(400).json({ error: 'รหัส 8 หลักไม่ถูกต้อง' });
  if (!phoneRegex.test(phone)) return res.status(400).json({ error: 'เบอร์ไม่ถูกต้อง ต้องเป็น 10 หลักและขึ้นต้นด้วย 0' });

  const expiresTimestamp = new Date(expiresAt).getTime();
  if (isNaN(expiresTimestamp) || expiresTimestamp <= Date.now()) return res.status(400).json({ error: 'วันหมดอายุไม่ถูกต้องหรือผ่านมาแล้ว' });

  const phoneList = loadOrCreatePhoneListFile();
  if (phoneList.some(entry => entry.number === phone)) return res.status(400).json({ error: 'เบอร์นี้มีอยู่ในระบบแล้ว' });

  phoneList.push({ number: phone, name, expiresAt: expiresTimestamp });
  saveToPhoneListFile(phoneList);
  res.json({ message: `เพิ่มเบอร์ ${phone} ชื่อ ${name} หมดอายุ ${new Date(expiresTimestamp).toLocaleString('th-TH')} สำเร็จ` });
  console.log(chalk.bgMagenta.black.bold(` 🎉 เพิ่มเบอร์ ${phone} ชื่อ ${name} หมดอายุ ${new Date(expiresTimestamp).toLocaleString('th-TH')} ผ่านเว็บ `));
  botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🎉 เพิ่มเบอร์ ${phone} ชื่อ ${name} หมดอายุ ${new Date(expiresTimestamp).toLocaleString('th-TH')} ผ่านเว็บ`, color: '#00ff00' });
});

app.delete('/api/delete-phone', (req, res) => {
  const { phone } = req.body;
  let phoneList = loadOrCreatePhoneListFile();
  const initialLength = phoneList.length;
  phoneList = phoneList.filter(entry => entry.number !== phone);
  if (phoneList.length === initialLength) return res.status(400).json({ error: 'ไม่พบเบอร์นี้ในระบบ' });
  saveToPhoneListFile(phoneList);
  res.json({ message: `ลบเบอร์ ${phone} สำเร็จ` });
  console.log(chalk.bgRed.black.bold(` 🗑️ ลบเบอร์ ${phone} ผ่านเว็บ `));
  botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🗑️ ลบเบอร์ ${phone} ผ่านเว็บ`, color: '#ff5555' });
});

app.put('/api/edit-phone', (req, res) => {
  const { oldPhone, newPhone, name, expiresAt } = req.body;
  const phoneRegex = /^0\d{9}$/;
  const phoneList = loadOrCreatePhoneListFile();
  const phoneEntry = phoneList.find(entry => entry.number === oldPhone);

  if (!phoneEntry) return res.status(400).json({ error: 'ไม่พบเบอร์นี้ในระบบ' });
  if (!phoneRegex.test(newPhone)) return res.status(400).json({ error: 'เบอร์ใหม่ไม่ถูกต้อง ต้องเป็น 10 หลักและขึ้นต้นด้วย 0' });

  const expiresTimestamp = new Date(expiresAt).getTime();
  if (isNaN(expiresTimestamp) || expiresTimestamp <= Date.now()) return res.status(400).json({ error: 'วันหมดอายุไม่ถูกต้องหรือผ่านมาแล้ว' });

  if (phoneList.some(entry => entry.number === newPhone && entry.number !== oldPhone)) {
    return res.status(400).json({ error: 'เบอร์ใหม่นี้มีอยู่ในระบบแล้ว' });
  }

  phoneEntry.number = newPhone;
  phoneEntry.name = name;
  phoneEntry.expiresAt = expiresTimestamp;
  saveToPhoneListFile(phoneList);
  res.json({ message: `แก้ไขเบอร์จาก ${oldPhone} เป็น ${newPhone} ชื่อ ${name} หมดอายุ ${new Date(expiresTimestamp).toLocaleString('th-TH')} สำเร็จ` });
  console.log(chalk.bgYellow.black.bold(` ✏️ แก้ไขเบอร์จาก ${oldPhone} เป็น ${newPhone} ชื่อ ${name} ผ่านเว็บ `));
  botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ✏️ แก้ไขเบอร์จาก ${oldPhone} เป็น ${newPhone} ชื่อ ${name} ผ่านเว็บ`, color: '#ffff00' });
});

app.put('/api/edit-phone-name', (req, res) => {
  const { phone, name } = req.body;
  const phoneList = loadOrCreatePhoneListFile();
  const phoneEntry = phoneList.find(entry => entry.number === phone);
  if (!phoneEntry) return res.status(400).json({ error: 'ไม่พบเบอร์นี้ในระบบ' });
  phoneEntry.name = name;
  saveToPhoneListFile(phoneList);
  res.json({ message: `แก้ไขชื่อของ ${phone} เป็น ${name} สำเร็จ` });
  console.log(chalk.bgYellow.black.bold(` ✏️ แก้ไขชื่อ ${phone} เป็น ${name} ผ่านเว็บ `));
  botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ✏️ แก้ไขชื่อ ${phone} เป็น ${name} ผ่านเว็บ`, color: '#ffff00' });
});

app.delete('/api/delete-bot', async (req, res) => {
  const { phone } = req.body;
  const clientIndex = clients.findIndex(c => c.phone === phone);
  if (clientIndex === -1) return res.status(400).json({ error: 'ไม่พบบัญชี Telegram นี้ในระบบ' });

  const client = clients[clientIndex];
  const sessionFile = path.join(sessionsDir, `${phone}.txt`);

  try {
    if (client.connected) await client.disconnect();
    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
    clients.splice(clientIndex, 1);
    res.json({ message: `ลบ bot ${phone} สำเร็จ` });
    console.log(chalk.bgRed.black.bold(` 🗑️ ลบ bot ${phone} ผ่านเว็บ `));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🗑️ ลบ bot ${phone} ผ่านเว็บ`, color: '#ff5555' });
  } catch (error) {
    res.status(500).json({ error: `เกิดข้อผิดพลาดในการลบ bot: ${error.message}` });
    console.log(chalk.bgRed.black.bold(` ❌ ข้อผิดพลาดในการลบ bot ${phone}: ${error.message} `));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ❌ ข้อผิดพลาดในการลบ bot ${phone}: ${error.message}`, color: '#ff5555' });
  }
});

app.get('/api/logs', (req, res) => {
  res.json({ logs: botLogs.slice(-50), apiStats, totalGroupsJoined });
});

app.get('/api/accounts', (req, res) => {
  const accounts = clients.map((client, index) => ({
    id: index,
    phone: client.phone || 'Unknown',
    status: client.connected ? 'Connected' : 'Disconnected'
  }));
  res.json(accounts);
});

app.post('/api/send-code', async (req, res) => {
  const { phone } = req.body;
  const phoneRegex = /^\+\d{10,12}$/;

  console.log(chalk.bgYellow.black.bold(`[DEBUG] Received phone: ${phone}`));
  if (!phone || !phoneRegex.test(phone)) {
    console.log(chalk.bgRed.black.bold(`[DEBUG] Invalid phone format: ${phone}`));
    return res.status(400).json({ error: 'เบอร์ไม่ถูกต้อง ต้องใช้รูปแบบสากล เช่น +66971432317' });
  }

  const sessionFile = path.join(sessionsDir, `${phone}.txt`);
  let sessionString = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, 'utf8') : '';
  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 20, timeout: 120000, retryDelay: 5000 });
  client.phone = phone;

  try {
    console.log(chalk.bgCyan.black.bold(`[DEBUG] Connecting to Telegram for ${phone}...`));
    await client.connect();
    if (await client.isUserAuthorized()) {
      if (!clients.some(c => c.phone === phone)) {
        clients.push(client);
        setupClientEvents(client);
      }
      console.log(chalk.bgGreen.black.bold(`[DEBUG] ${phone} already authorized`));
      return res.json({ message: `บัญชี ${phone} เชื่อมต่อสำเร็จ (มีเซสชันอยู่แล้ว)` });
    }

    console.log(chalk.bgYellow.black.bold(`[DEBUG] Sending verification code to ${phone}...`));
    const sendCodeResult = await client.invoke(new Api.auth.SendCode({
      phoneNumber: phone,
      apiId: API_ID,
      apiHash: API_HASH,
      settings: new Api.CodeSettings({})
    }));

    client.phoneCodeHash = sendCodeResult.phoneCodeHash;
    if (!clients.some(c => c.phone === phone)) clients.push(client);
    console.log(chalk.bgGreen.black.bold(`[DEBUG] Code sent to ${phone}`));
    res.json({ message: `ส่งรหัสยืนยันไปยัง ${phone} เรียบร้อยแล้ว`, phone });
  } catch (error) {
    console.error(chalk.bgRed.black.bold(`[DEBUG] Error in /api/send-code for ${phone}: ${error.message}`));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ❌ ข้อผิดพลาดใน /api/send-code: ${error.message}`, color: '#ff5555' });
    res.status(500).json({ error: `เกิดข้อผิดพลาด: ${error.message}` });
  }
});

app.post('/api/verify-code', async (req, res) => {
  const { phone, code, password } = req.body;
  const client = clients.find(c => c.phone === phone && c.phoneCodeHash);
  if (!client) return res.status(400).json({ error: 'ไม่พบเซสชันสำหรับเบอร์นี้ กรุณาส่งรหัสใหม่' });

  try {
    await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash: client.phoneCodeHash, phoneCode: code }));
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      if (!password) return res.status(401).json({ error: 'ต้องการรหัสผ่าน 2FA', requiresPassword: true });
      try {
        await client.invoke(new Api.auth.CheckPassword({ password }));
      } catch (passwordErr) {
        return res.status(401).json({ error: `รหัสผ่านไม่ถูกต้อง: ${passwordErr.message}` });
      }
    } else {
      return res.status(400).json({ error: `รหัสยืนยันไม่ถูกต้อง: ${err.message}` });
    }
  }

  fs.writeFileSync(path.join(sessionsDir, `${phone}.txt`), client.session.save());
  setupClientEvents(client);
  console.log(chalk.bgGreen.black.bold(` 🌟 ล็อกอินบัญชี ${phone} สำเร็จ `));
  botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌟 ล็อกอินบัญชี ${phone} สำเร็จ`, color: '#00ff00' });
  res.json({ message: `ล็อกอินบัญชี ${phone} สำเร็จ` });
});

// Routes for serving HTML pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/phones', (req, res) => res.sendFile(path.join(__dirname, 'public', 'phones.html')));
app.get('/details', (req, res) => res.sendFile(path.join(__dirname, 'public', 'details.html')));
app.get('/logs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'logs.html')));
app.get('/admin-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/expired', (req, res) => res.sendFile(path.join(__dirname, 'public', 'expired.html')));

app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>🛠️ แผงควบคุมแอดมิน</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Inter', sans-serif; 
          background: url('https://i.pinimg.com/1200x/80/7b/0d/807b0d00ea3aab1bdf89012248e9d97a.jpg') no-repeat center center fixed; 
          background-size: cover; 
          color: #FFFFFF; 
          line-height: 1.6; 
          display: flex; 
          flex-direction: column; 
          min-height: 100vh; 
          padding: 0;
        }
        .header { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          padding: 15px 20px; 
          background: rgba(30, 58, 138, 0.9); 
          width: 100%; 
          position: fixed; 
          top: 0; 
          z-index: 1000; 
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        }
        .header h1 { 
          font-size: 1.5em; 
          text-shadow: 0 0 5px rgba(255, 255, 255, 0.7); 
          margin: 0; 
        }
        .back-btn { 
          background: rgba(255, 255, 255, 0.2); 
          border: none; 
          padding: 8px; 
          border-radius: 4px; 
          cursor: pointer; 
          transition: background 0.3s; 
        }
        .back-btn:hover { background: rgba(255, 255, 255, 0.4); }
        .back-btn i { color: #FFFFFF; font-size: 1.2em; }
        .nav-menu { 
          display: none; /* ซ่อนเมนูแนวตั้ง */
        }
        .container { 
          width: 100%; 
          margin: 70px 10px 10px 10px; 
          padding: 10px; 
          flex: 1; 
        }
        h2 { 
          font-size: 1.3em; 
          font-weight: 600; 
          margin: 20px 0 10px; 
          text-shadow: 0 0 5px rgba(255, 255, 255, 0.5); 
          display: flex; 
          align-items: center; 
          gap: 6px; 
        }
        table { 
          width: 100%; 
          border-collapse: collapse; 
          background: rgba(255, 255, 255, 0.95); 
          border-radius: 8px; 
          overflow: hidden; 
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2); 
          margin-bottom: 15px; 
          font-size: 0.9em; 
        }
        th, td { padding: 10px; text-align: left; }
        th { background: #1E3A8A; color: #FFFFFF; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.85em; }
        td { border-bottom: 1px solid #E5E7EB; color: #1E3A8A; }
        tr:hover { background: rgba(243, 244, 246, 0.9); }
        .form-container { 
          display: flex; 
          flex-direction: column; 
          gap: 15px; 
          margin: 15px 0; 
        }
        .form, .code-form { 
          width: 100%; 
          padding: 15px; 
          background: rgba(255, 255, 255, 0.95); 
          border-radius: 8px; 
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2); 
          display: flex; 
          flex-direction: column; 
          gap: 10px; 
        }
        .form h3, .code-form h3 { 
          font-size: 1.1em; 
          color: #1E3A8A; 
          margin-bottom: 8px; 
          text-align: center; 
        }
        input { 
          padding: 8px; 
          border: 1px solid #D1D5DB; 
          border-radius: 4px; 
          outline: none; 
          transition: border 0.3s; 
          background: #FFFFFF; 
          font-size: 0.9em; 
          width: 100%; 
        }
        input:focus { border-color: #3B82F6; box-shadow: 0 0 5px rgba(59, 130, 246, 0.5); }
        button { 
          padding: 10px; 
          background: #3B82F6; 
          border: none; 
          border-radius: 4px; 
          color: #FFFFFF; 
          font-weight: 600; 
          cursor: pointer; 
          transition: background 0.3s, transform 0.2s; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          gap: 6px; 
          font-size: 0.9em; 
        }
        button:hover { background: #1E3A8A; transform: scale(1.02); }
        .edit-btn, .delete-btn { 
          padding: 6px 10px; 
          font-size: 0.85em; 
          margin-right: 5px; 
        }
        .edit-btn { background: #22C55E; }
        .edit-btn:hover { background: #16A34A; }
        .delete-btn { background: #EF4444; }
        .delete-btn:hover { background: #B91C1C; }
        .toast-container { 
          position: fixed; 
          top: 10px; 
          right: 10px; 
          z-index: 1001; 
        }
        .toast { 
          background: rgba(255, 255, 255, 0.95); 
          color: #1E3A8A; 
          padding: 10px 15px; 
          border-radius: 6px; 
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2); 
          margin-bottom: 8px; 
          display: flex; 
          align-items: center; 
          gap: 8px; 
          opacity: 0; 
          transform: translateX(100%); 
          animation: slideIn 0.5s ease forwards, slideOut 0.5s ease 4.5s forwards; 
          font-size: 0.9em; 
        }
        .toast.error { background: rgba(239, 68, 68, 0.95); color: #FFFFFF; }
        .toast.success { background: rgba(34, 197, 94, 0.95); color: #FFFFFF; }
        .toast i { font-size: 1em; }
        @keyframes slideIn {
          0% { opacity: 0; transform: translateX(100%); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideOut {
          0% { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(100%); }
        }
        @media (min-width: 768px) {
          .container { max-width: 700px; margin: 70px auto 20px auto; }
          .form-container { flex-direction: row; flex-wrap: wrap; justify-content: center; }
          .form, .code-form { max-width: 350px; }
          .header h1 { font-size: 2em; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1><i class="fas fa-user-shield"></i> แผงควบคุมแอดมิน</h1>
        <a href="/" class="back-btn"><i class="fas fa-arrow-left"></i></a>
      </div>
      <div class="nav-menu" id="navMenu">
        <!-- เมนูถูกซ่อน -->
      </div>
      <div class="toast-container" id="toastContainer"></div>
      <div class="container">
        <h2><i class="fas fa-robot"></i> บัญชี Telegram</h2>
        <table id="accountsTable">
          <thead><tr><th>ID</th><th><i class="fas fa-phone"></i> เบอร์</th><th><i class="fas fa-signal"></i> สถานะ</th><th><i class="fas fa-tools"></i> จัดการ</th></tr></thead>
          <tbody></tbody>
        </table>

        <div class="form-container">
          <div class="form">
            <h3><i class="fas fa-plus-circle"></i> เพิ่มบัญชี Telegram</h3>
            <input type="text" id="telegramPhoneInput" placeholder="เบอร์โทร (เช่น +66987654321)">
            <button onclick="sendCode()"><i class="fas fa-paper-plane"></i> ส่งรหัสยืนยัน</button>
            <input type="text" id="telegramCodeInput" placeholder="รหัสยืนยันที่ได้รับ">
            <input type="password" id="telegramPasswordInput" placeholder="รหัสผ่าน 2FA (ถ้ามี)" style="display: none;">
            <button onclick="verifyCode()"><i class="fas fa-check"></i> ยืนยันและล็อกอิน</button>
          </div>

          <div class="form">
            <h3><i class="fas fa-plus-circle"></i> เพิ่มเบอร์ดวงดาว</h3>
            <input type="text" id="phoneInput" placeholder="เบอร์ (เช่น 0987654321)">
            <input type="text" id="codeInput" placeholder="รหัส 8 หลัก">
            <input type="text" id="nameInput" placeholder="ชื่อ">
            <input type="datetime-local" id="expiresAtInput" placeholder="วันหมดอายุ">
            <button onclick="addPhone()"><i class="fas fa-plus"></i> เพิ่มเบอร์</button>
          </div>

          <div class="code-form">
            <h3><i class="fas fa-key"></i> จัดการรหัส</h3>
            <input type="text" id="currentAdminCodeInput" placeholder="รหัสแอดมินปัจจุบัน">
            <input type="text" id="newAdminCodeInput" placeholder="รหัสแอดมินใหม่ (ขั้นต่ำ 8 ตัว)">
            <input type="text" id="newAddPhoneCodeInput" placeholder="รหัสเพิ่มเบอร์ใหม่ (ขั้นต่ำ 8 ตัว)">
            <button onclick="updateCodes()"><i class="fas fa-save"></i> อัปเดตรหัส</button>
          </div>
        </div>

        <h2><i class="fas fa-list"></i> จัดการเบอร์ดวงดาว</h2>
        <table id="phonesTable">
          <thead><tr><th>อันดับ</th><th><i class="fas fa-phone"></i> เบอร์</th><th><i class="fas fa-user"></i> ชื่อ</th><th><i class="fas fa-money-bill-wave"></i> รายได้</th><th><i class="fas fa-calendar-alt"></i> หมดอายุ</th><th><i class="fas fa-tools"></i> จัดการ</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>

      <script>
        function showToast(message, type = 'success') {
          const toastContainer = document.getElementById('toastContainer');
          const toast = document.createElement('div');
          toast.className = \`toast \${type}\`;
          toast.innerHTML = \`<i class="\${type === 'success' ? 'fas fa-check-circle' : 'fas fa-exclamation-triangle'}"></i> \${message}\`;
          toastContainer.appendChild(toast);
          setTimeout(() => toast.remove(), 5000);
        }

        async function fetchAccounts() {
          try {
            const response = await fetch('/api/accounts');
            if (!response.ok) throw new Error('Failed to fetch accounts');
            const accounts = await response.json();
            const tbody = document.querySelector('#accountsTable tbody');
            tbody.innerHTML = accounts.length === 0 ? '<tr><td colspan="4">ยังไม่มีบัญชี</td></tr>' : '';
            accounts.forEach(account => {
              const tr = document.createElement('tr');
              tr.innerHTML = \`<td>\${account.id}</td><td>\${account.phone}</td><td>\${account.status}</td><td><button class="delete-btn" onclick="deleteBot('\${account.phone}')"><i class="fas fa-trash"></i> ลบ</button></td>\`;
              tbody.appendChild(tr);
            });
          } catch (error) {
            console.error('Error fetching accounts:', error);
            showToast('เกิดข้อผิดพลาดในการโหลดบัญชี', 'error');
          }
        }

        async function fetchPhones() {
          try {
            const response = await fetch('/api/phones');
            if (!response.ok) throw new Error('Failed to fetch phones');
            const phones = await response.json();
            const tbody = document.querySelector('#phonesTable tbody');
            tbody.innerHTML = phones.length === 0 ? '<tr><td colspan="6">ยังไม่มีเบอร์</td></tr>' : '';
            phones.forEach(phone => {
              const tr = document.createElement('tr');
              tr.innerHTML = \`
                <td>\${phone.rank}</td>
                <td><input type="text" class="edit-input" value="\${phone.number}" onchange="editPhone('\${phone.number}', this, 'number')"></td>
                <td><input type="text" class="edit-input" value="\${phone.name}" onchange="editPhone('\${phone.number}', this, 'name')"></td>
                <td>\${phone.earnings.toFixed(2)}</td>
                <td><input type="datetime-local" class="edit-input" value="\${phone.expiresAt ? new Date(phone.expiresAt).toISOString().slice(0,16) : ''}" onchange="editPhone('\${phone.number}', this, 'expiresAt')"></td>
                <td>
                  <button class="edit-btn" onclick="savePhoneEdit('\${phone.number}')"><i class="fas fa-save"></i></button>
                  <button class="delete-btn" onclick="deletePhone('\${phone.number}')"><i class="fas fa-trash"></i></button>
                </td>
              \`;
              tbody.appendChild(tr);
            });
          } catch (error) {
            console.error('Error fetching phones:', error);
            showToast('เกิดข้อผิดพลาดในการโหลดรายชื่อเบอร์', 'error');
          }
        }

        async function sendCode() {
          const phone = document.getElementById('telegramPhoneInput').value.trim();
          if (!phone) return showToast('กรุณาใส่เบอร์โทร!', 'error');
          try {
            const response = await fetch('/api/send-code', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone })
            });
            const result = await response.json();
            if (response.ok) showToast(result.message, 'success');
            else showToast(result.error, 'error');
          } catch (error) {
            showToast('การเชื่อมต่อ Telegram ล้มเหลว: ' + error.message, 'error');
          }
        }

        async function verifyCode() {
          const phone = document.getElementById('telegramPhoneInput').value.trim();
          const code = document.getElementById('telegramCodeInput').value.trim();
          const password = document.getElementById('telegramPasswordInput').value.trim();
          if (!phone || !code) return showToast('กรุณาใส่เบอร์โทรและรหัสยืนยัน!', 'error');
          try {
            const response = await fetch('/api/verify-code', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone, code, password })
            });
            const result = await response.json();
            if (response.ok) {
              showToast(result.message, 'success');
              document.getElementById('telegramPhoneInput').value = '';
              document.getElementById('telegramCodeInput').value = '';
              document.getElementById('telegramPasswordInput').value = '';
              document.getElementById('telegramPasswordInput').style.display = 'none';
              fetchAccounts();
            } else {
              showToast(result.error, 'error');
              if (result.requiresPassword) document.getElementById('telegramPasswordInput').style.display = 'block';
            }
          } catch (error) {
            showToast('การเชื่อมต่อ Telegram ล้มเหลว: ' + error.message, 'error');
          }
        }

        async function addPhone() {
          const phone = document.getElementById('phoneInput').value.trim();
          const code = document.getElementById('codeInput').value.trim();
          const name = document.getElementById('nameInput').value.trim();
          const expiresAt = document.getElementById('expiresAtInput').value;
          if (!phone || !code || !name || !expiresAt) return showToast('กรุณากรอกข้อมูลให้ครบถ้วน!', 'error');
          try {
            const response = await fetch('/api/add-phone', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone, code, name, expiresAt })
            });
            const result = await response.json();
            if (response.ok) {
              showToast('เพิ่มเบอร์สำเร็จ!', 'success');
              document.getElementById('phoneInput').value = '';
              document.getElementById('codeInput').value = '';
              document.getElementById('nameInput').value = '';
              document.getElementById('expiresAtInput').value = '';
              fetchPhones();
            } else showToast(result.error, 'error');
          } catch (error) {
            showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
          }
        }

        async function deletePhone(phone) {
          if (!confirm('แน่ใจหรือไม่ว่าต้องการลบเบอร์ ' + phone + '?')) return;
          try {
            const response = await fetch('/api/delete-phone', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone })
            });
            const result = await response.json();
            if (response.ok) {
              showToast(result.message, 'success');
              fetchPhones();
            } else showToast(result.error, 'error');
          } catch (error) {
            showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
          }
        }

        let editData = {};
        function editPhone(oldPhone, input, field) {
          if (!editData[oldPhone]) editData[oldPhone] = {};
          if (field === 'expiresAt') {
            editData[oldPhone][field] = new Date(input.value).getTime();
          } else {
            editData[oldPhone][field] = input.value;
          }
        }

        async function savePhoneEdit(oldPhone) {
          if (!editData[oldPhone]) return showToast('ไม่มีข้อมูลที่แก้ไขสำหรับเบอร์ ' + oldPhone, 'error');
          const data = {
            oldPhone,
            newPhone: editData[oldPhone].number || oldPhone,
            name: editData[oldPhone].name || '',
            expiresAt: editData[oldPhone].expiresAt || new Date().setFullYear(new Date().getFullYear() + 1)
          };
          try {
            const response = await fetch('/api/edit-phone', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
            const result = await response.json();
            if (response.ok) {
              showToast(result.message, 'success');
              delete editData[oldPhone];
              fetchPhones();
            } else showToast(result.error, 'error');
          } catch (error) {
            showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
          }
        }

        async function deleteBot(phone) {
          if (!confirm('แน่ใจหรือไม่ว่าต้องการลบ bot ' + phone + '?')) return;
          try {
            const response = await fetch('/api/delete-bot', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone })
            });
            const result = await response.json();
            if (response.ok) {
              showToast(result.message, 'success');
              fetchAccounts();
            } else showToast(result.error, 'error');
          } catch (error) {
            showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
          }
        }

        async function updateCodes() {
          const currentAdminCode = document.getElementById('currentAdminCodeInput').value.trim();
          const newAdminCode = document.getElementById('newAdminCodeInput').value.trim();
          const newAddPhoneCode = document.getElementById('newAddPhoneCodeInput').value.trim();

          if (!currentAdminCode) return showToast('กรุณาใส่รหัสแอดมินปัจจุบัน', 'error');
          if (!newAdminCode && !newAddPhoneCode) return showToast('กรุณาใส่รหัสใหม่อย่างน้อย 1 รหัส', 'error');
          if (newAdminCode && newAdminCode.length < 8) return showToast('รหัสแอดมินใหม่ต้องมีอย่างน้อย 8 ตัว', 'error');
          if (newAddPhoneCode && newAddPhoneCode.length < 8) return showToast('รหัสเพิ่มเบอร์ใหม่ต้องมีอย่างน้อย 8 ตัว', 'error');

          try {
            const response = await fetch('/api/update-admin-codes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adminCode: newAdminCode || undefined, addPhoneCode: newAddPhoneCode || undefined, authCode: currentAdminCode })
            });
            const result = await response.json();
            if (response.ok) {
              showToast(result.message, 'success');
              document.getElementById('currentAdminCodeInput').value = '';
              document.getElementById('newAdminCodeInput').value = '';
              document.getElementById('newAddPhoneCodeInput').value = '';
            } else showToast(result.error, 'error');
          } catch (error) {
            showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
          }
        }

        fetchAccounts();
        fetchPhones();
        setInterval(fetchAccounts, 5000);
        setInterval(fetchPhones, 5000);
      </script>
    </body>
    </html>
  `);
});

// Setup Telegram Client Events
function setupClientEvents(client) {
  client.addEventHandler(async (event) => {
    const messageText = event.message.text;

    switch (true) {
      case messageText.startsWith('/admin'): await handleAdmin(event, client); break;
      case messageText.startsWith('/scanangpao'): await handleScanAngpao(event, client); break;
      default: await handleNewMessage(event, client); break;
    }
  }, new NewMessage({}));
}

async function loadExistingSessions() {
  const files = fs.readdirSync(sessionsDir).filter(file => file.endsWith('.txt'));
  for (const file of files) {
    const phone = path.basename(file, '.txt');
    const sessionString = fs.readFileSync(path.join(sessionsDir, file), 'utf8');
    const session = new StringSession(sessionString);
    const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 20, timeout: 120000, retryDelay: 5000 });
    client.phone = phone;
    try {
      console.log(chalk.bgCyan.black.bold(` กำลังโหลดเซสชันสำหรับ ${phone}... `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌌 กำลังโหลดเซสชันสำหรับ ${phone}`, color: '#00ffcc' });
      await client.connect();
      if (await client.isUserAuthorized()) {
        clients.push(client);
        setupClientEvents(client);
        console.log(chalk.bgGreen.black.bold(` 🌟 โหลดเซสชัน ${phone} สำเร็จ `));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌟 โหลดเซสชัน ${phone} สำเร็จ`, color: '#00ff00' });
      } else {
        console.log(chalk.bgRed.black.bold(` ❌ เซสชัน ${phone} ไม่ถูกต้อง ลบไฟล์เซสชันออก `));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ❌ เซสชัน ${phone} ไม่ถูกต้อง ลบไฟล์เซสชันออก`, color: '#ff5555' });
        fs.unlinkSync(path.join(sessionsDir, file));
      }
    } catch (error) {
      console.log(chalk.bgRed.black.bold(` ❌ ข้อผิดพลาดในการโหลดเซสชัน ${phone}: ${error.message} `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ❌ ข้อผิดพลาดในการโหลดเซสชัน ${phone}: ${error.message}`, color: '#ff5555' });
    }
  }
}

// Start Server
(async () => {
  await loadExistingSessions();
  loadOrCreateGroupCountFile();
  loadOrCreateAdminCodesFile();

  setInterval(() => {
  loadOrCreatePhoneListFile();
  console.log(chalk.bgCyan.black.bold(` ⏰ ตรวจสอบเบอร์ที่หมดอายุเรียบร้อยแล้ว `));
  botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ⏰ ตรวจสอบเบอร์ที่หมดอายุเรียบร้อยแล้ว`, color: '#00ffcc' });
}, 10 * 60 * 1000); // ตรวจสอบทุก 10 นาที

  app.listen(port, () => {
    console.log(chalk.bgGreen.black.bold(` 🌐 Server running at http://0.0.0.0:${port} (เซิร์ฟเวอร์เริ่มทำงานที่) `));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌐 เซิร์ฟเวอร์เริ่มทำงานที่ http://localhost:${port}`, color: '#00ff00' });
  });
})();
