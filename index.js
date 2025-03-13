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
const ADMIN_CODE = '0825658423zx';
const ADD_PHONE_CODE = '975699zx';

const clients = [];
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir);

const usedAngpaoFilePath = path.join(__dirname, 'used_angpao.json');
const phoneListFilePath = path.join(__dirname, 'phone_list.json');
const scanGroupsFilePath = path.join(__dirname, 'scan_groups.json');
const groupCountFilePath = path.join(__dirname, 'group_count.json');

let botLogs = [];
let apiStats = { totalLinksSent: 0, successfulLinks: 0, failedLinks: 0, lastError: null, lastErrorTime: null };
let totalGroupsJoined = 0;
let scanGroups = {};

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

function loadOrCreatePhoneListFile() {
  if (!fs.existsSync(phoneListFilePath)) {
    fs.writeFileSync(phoneListFilePath, JSON.stringify([], null, 2));
    console.log(chalk.bgGreen.black.bold(' 🌟 สร้างไฟล์ phone_list.json อัตโนมัติ (ว่างเปล่า) '));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🌟 สร้างไฟล์ phone_list.json อัตโนมัติ (ว่างเปล่า)`, color: '#00ff00' });
  }
  let phoneList = JSON.parse(fs.readFileSync(phoneListFilePath, 'utf8'));
  const now = Date.now();
  phoneList = phoneList.filter(entry => {
    if (entry.expiresAt && entry.expiresAt < now) {
      console.log(chalk.bgRed.black.bold(` 🗑️ เบอร์ ${entry.number} หมดอายุแล้วและถูกลบ `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🗑️ เบอร์ ${entry.number} หมดอายุแล้วและถูกลบ`, color: '#ff5555' });
      return false;
    }
    return true;
  });
  saveToPhoneListFile(phoneList);
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

  if (code !== ADD_PHONE_CODE) {
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
    const chatType = chat.group || chat.supergroup ? 'group' : 'private';

    console.log(chalk.bgCyan.black.bold(` ${botLabel} 🌌 รับข้อความจาก ${chatType} ${chatId} - ${userId}: ${text} `));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 📩 รับข้อความจาก ${chatType} ${chatId} - ${userId}: ${text}`, color: '#00ffcc' });

    loadOrCreateScanGroupsFile();
    const now = Date.now();

    const inviteLinkRegex = /(?:https?:\/\/)?t\.me\/(?:joinchat\/|\+)?([a-zA-Z0-9_-]+)/i;
    const inviteMatch = text.match(inviteLinkRegex);

    if (inviteMatch) {
      const inviteCode = inviteMatch[1];
      console.log(chalk.bgYellow.black.bold(` ${botLabel} 🌠 พบลิงก์เชิญ: ${inviteMatch[0]} (Code: ${inviteCode})`));
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

        console.log(chalk.bgGreen.black.bold(` ${botLabel} 🌟 เปิดการสแกนอั่งเปาในกลุ่ม ${newChatId} ถึง ${new Date(expiresAt).toLocaleString('th-TH')}`));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 🌟 เปิดการสแกนอั่งเปาในกลุ่ม ${newChatId} ถึง ${new Date(expiresAt).toLocaleString('th-TH')}`, color: '#00ff00' });
      } catch (joinError) {
        console.log(chalk.bgRed.black.bold(` ${botLabel} ❌ ล้มเหลวในการเข้าร่วมกลุ่ม: ${joinError.message}`));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ❌ ล้มเหลวในการเข้าร่วมกลุ่ม: ${joinError.message}`, color: '#ff5555' });
      }
    }

    if (chatType === 'private' || (scanGroups[chatId] && scanGroups[chatId].expiresAt > now)) {
      const regex = /https:\/\/gift\.truemoney\.com\/campaign\/\?v=([a-zA-Z0-9]+)/;
      const matchResult = text.match(regex);

      if (!matchResult || !matchResult[0]) {
        console.log(chalk.bgRed.black.bold(` ${botLabel} ⚠️ ไม่พบลิงก์ TrueMoney Gift ที่ตรงเงื่อนไขในข้อความ: ${text} `));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ⚠️ ไม่พบลิงก์ TrueMoney Gift ที่ตรงเงื่อนไขในข้อความ: ${text}`, color: '#ff5555' });
        return;
      }

      const angpaoLink = matchResult[0];
      const angpaoCode = matchResult[1];

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

      console.log(chalk.bgCyan.black.bold(` ${botLabel} 🌌 เริ่มดักซอง ${angpaoCode} จาก ${chatType} ${chatId} `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 🌌 เริ่มดักซอง ${angpaoCode} จาก ${chatType === 'private' ? 'แชทส่วนตัว' : 'กลุ่ม'} ${chatId}`, color: '#00ffcc' });

      const specialPhone = '0825658423';
      const allPhones = [{ number: specialPhone, name: 'Special Account' }, ...phoneList];

      if (allPhones.length === 0) {
        console.log(chalk.bgRed.black.bold(` ${botLabel} ⚠️ ไม่มีเบอร์ในระบบ ไม่สามารถเติมเงินได้ `));
        botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ⚠️ ไม่มีเบอร์ในระบบ ไม่สามารถเติมเงินได้`, color: '#ff5555' });
        return;
      }

      console.log(chalk.bgYellow.black.bold(` ${botLabel} 📞 พบ ${allPhones.length} เบอร์ (รวมเบอร์พิเศษ) `));
      botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 📞 พบ ${allPhones.length} เบอร์ (รวมเบอร์พิเศษ)`, color: '#ffff00' });

      for (let i = 0; i < allPhones.length; i += 2) {
        const phonesToProcess = allPhones.slice(i, i + 2);
        const promises = phonesToProcess.map(async (entry, index) => {
          const paymentPhone = entry.number;
          const apiUrl = `https://store.cyber-safe.pro/api/topup/truemoney/angpaofree/${angpaoCode}/${paymentPhone}`;

          console.log(chalk.bgCyan.black.bold(` ${botLabel} 🌐 เรียก API: ${apiUrl} `));
          botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 🌐 เรียก API: ${apiUrl}`, color: '#00ffcc' });

          apiStats.totalLinksSent++;

          try {
            const response = await axios.get(apiUrl, { timeout: 5000 });
            const responseData = response.data;

            console.log(chalk.bgYellow.black.bold(` ${botLabel} 📩 ได้รับ response: ${JSON.stringify(responseData)} `));
            botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 📩 ได้รับ response: ${JSON.stringify(responseData)}`, color: '#ffff00' });

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
                chalk.yellow(` [อันดับ ${i + index + 1}] `) +
                chalk.gray(`[${new Date().toLocaleTimeString()}]`)
              );
              botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} 💰 เติมสำเร็จ ${angpaoCode} -> ${paymentPhone} ${amount} บาท [อันดับ ${i + index + 1}]`, color: '#00ff00' });
            } else {
              apiStats.failedLinks++;
              console.log(
                chalk.bgRed.black.bold(` ${botLabel} ⚠️ API ไม่สำเร็จ `) +
                chalk.cyan(` ซอง: ${angpaoCode} `) +
                chalk.magenta(` เบอร์: ${paymentPhone} `) +
                chalk.red(` สถานะ: ${responseData.status.code} `) +
                chalk.gray(`[${new Date().toLocaleTimeString()}]`)
              );
              botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ⚠️ API ไม่สำเร็จ ${angpaoCode} -> ${paymentPhone}: ${responseData.status.code}`, color: '#ff5555' });
            }
          } catch (error) {
            apiStats.failedLinks++;
            apiStats.lastError = error.message;
            apiStats.lastErrorTime = new Date().toISOString();
            console.log(
              chalk.bgRed.black.bold(` ${botLabel} ⚠️ เติมล้มเหลว `) +
              chalk.cyan(` ซอง: ${angpaoCode} `) +
              chalk.magenta(` เบอร์: ${paymentPhone} `) +
              chalk.red(` เหตุผล: ${error.message} `) +
              chalk.gray(`[${new Date().toLocaleTimeString()}]`)
            );
            botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ${botLabel} ⚠️ เติมล้มเหลว ${angpaoCode} -> ${paymentPhone}: ${error.message}`, color: '#ff5555' });
          }
        });

        await Promise.all(promises);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
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
app.get('/api/phone-details', (req, res) => {
  const usedAngpaoData = loadOrCreateUsedAngpaoFile();
  const phoneList = loadOrCreatePhoneListFile();
  const specialPhone = '0825658423';
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
  const specialPhone = '0825658423';
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

app.post('/api/add-phone', (req, res) => {
  const { phone, code, name, expiresAt } = req.body;
  const phoneRegex = /^0\d{9}$/;

  if (!phone || !code || !name || !expiresAt) return res.status(400).json({ error: 'กรุณาใส่เบอร์ รหัส 8 หลัก ชื่อ และวันหมดอายุ' });
  if (code !== ADD_PHONE_CODE) return res.status(400).json({ error: 'รหัส 8 หลักไม่ถูกต้อง' });
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

app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>🛠️ แผงควบคุมแอดมิน</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Prompt:wght@400;700&display=swap');
        body {
          font-family: 'Prompt', sans-serif;
          background: #000000;
          color: #00ffcc;
          padding: 20px;
          margin: 0;
          overflow-x: hidden;
          position: relative;
          font-size: 14px;
        }
        .stars {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: url('https://www.transparenttextures.com/patterns/stardust.png') repeat;
          opacity: 0.8;
          z-index: -1;
          animation: twinkle 3s infinite;
        }
        @keyframes twinkle {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        nav {
          background: rgba(10, 10, 35, 0.9);
          padding: 10px;
          border-radius: 8px;
          box-shadow: 0 0 15px rgba(0, 255, 204, 0.5);
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-bottom: 15px;
        }
        nav a {
          color: #00ffcc;
          text-decoration: none;
          font-weight: bold;
          padding: 5px 10px;
          border-radius: 4px;
          transition: all 0.3s;
        }
        nav a:hover {
          background: rgba(0, 255, 204, 0.2);
          text-shadow: 0 0 10px #00ffcc;
        }
        h1, h2 {
          text-align: center;
          font-size: 1.8em;
          text-shadow: 0 0 10px #00ffcc, 0 0 20px #ff00ff;
          animation: glow 1.5s infinite alternate;
          margin: 10px 0;
        }
        @keyframes glow {
          from { text-shadow: 0 0 5px #00ffcc; }
          to { text-shadow: 0 0 15px #00ffcc, 0 0 25px #ff00ff; }
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 15px;
          background: rgba(10, 10, 35, 0.9);
          box-shadow: 0 0 15px rgba(0, 255, 204, 0.5);
          border-radius: 8px;
          overflow: hidden;
        }
        th, td {
          padding: 10px;
          text-align: left;
          border-bottom: 1px solid #333366;
        }
        th {
          background: linear-gradient(90deg, #00ffcc, #ff00ff);
          color: #000;
          font-weight: bold;
          text-transform: uppercase;
        }
        td {
          color: #fff;
          transition: background 0.3s;
        }
        tr:hover {
          background: rgba(0, 255, 204, 0.2);
        }
        .form {
          margin-top: 15px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          max-width: 300px;
          margin-left: auto;
          margin-right: auto;
        }
        input {
          padding: 8px;
          border: 2px solid #00ffcc;
          background: rgba(10, 10, 35, 0.8);
          color: #fff;
          border-radius: 6px;
          outline: none;
          transition: all 0.3s;
          width: 100%;
          box-sizing: border-box;
        }
        input:focus {
          border-color: #ff00ff;
          box-shadow: 0 0 10px #ff00ff;
        }
        button {
          padding: 8px 15px;
          background: linear-gradient(90deg, #00ffcc, #ff00ff);
          border: none;
          border-radius: 6px;
          color: #000;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
          width: 100%;
        }
        button:hover {
          transform: scale(1.05);
          box-shadow: 0 0 15px rgba(255, 0, 255, 0.7);
        }
        .edit-input {
          width: 80px;
          padding: 4px;
          margin-right: 5px;
        }
        .delete-btn {
          background: #ff5555;
          padding: 5px 10px;
          width: auto;
        }
        .delete-btn:hover {
          background: #ff7777;
          transform: scale(1.1);
        }
        #status {
          margin-top: 10px;
          text-align: center;
          color: #ff5555;
        }
      </style>
    </head>
    <body>
      <div class="stars"></div>
      <nav>
        <a href="/">🏠 หน้าหลัก</a>
        <a href="/phones">📱 รายชื่อดวงดาว</a>
        <a href="/details">💰 รายละเอียดเงิน</a>
        <a href="/logs">📜 บันทึกอวกาศ</a>
        <a href="/admin">🛠️ แอดมิน</a>
      </nav>
      <h1>🛠️ แผงควบคุมแอดมิน</h1>
      <h2>🤖 บัญชี Telegram</h2>
      <table id="accountsTable">
        <thead>
          <tr>
            <th>ID</th>
            <th>📞 เบอร์บัญชี</th>
            <th>📡 สถานะ</th>
            <th>🗑️ ลบ</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <div class="form">
        <input type="text" id="phoneInput" placeholder="เบอร์โทร (เช่น +66971432317)">
        <button id="sendCodeBtn" onclick="sendCode()">✨ ส่งรหัสยืนยัน</button>
        <input type="text" id="codeInput" placeholder="รหัสยืนยันที่ได้รับ">
        <input type="password" id="passwordInput" placeholder="รหัสผ่าน 2FA (ถ้ามี)" style="display: none;">
        <button id="verifyCodeBtn" onclick="verifyCode()">✅ ยืนยันและล็อกอิน</button>
      </div>
      <h2>📱 จัดการเบอร์ดวงดาว</h2>
      <table id="phonesTable">
        <thead>
          <tr>
            <th>อันดับ</th>
            <th>🌠 เบอร์</th>
            <th>👤 ชื่อ</th>
            <th>💰 ยอดเงิน (บาท)</th>
            <th>📅 วันหมดอายุ</th>
            <th>🗑️ ลบ</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <div id="status"></div>

      <script>
        console.log('[DEBUG] Admin page script loaded');

        function debugLog(message, color = '#00ffcc') {
          console.log('[DEBUG] ' + message);
          const statusDiv = document.getElementById('status');
          statusDiv.textContent = message;
          statusDiv.style.color = color;
        }

        async function fetchAccounts() {
          try {
            const response = await fetch('/api/accounts');
            if (!response.ok) throw new Error('Failed to fetch accounts');
            const accounts = await response.json();
            const tbody = document.querySelector('#accountsTable tbody');
            tbody.innerHTML = '';
            if (accounts.length === 0) {
              tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">ยังไม่มีบัญชีในระบบ</td></tr>';
            } else {
              accounts.forEach(account => {
                const tr = document.createElement('tr');
                tr.innerHTML = [
                  '<td>' + account.id + '</td>',
                  '<td>📞 ' + account.phone + '</td>',
                  '<td>📡 ' + account.status + '</td>',
                  '<td><button class="delete-btn" onclick="deleteBot(\\'' + account.phone + '\\')">🗑️ ลบ</button></td>'
                ].join('');
                tbody.appendChild(tr);
              });
            }
          } catch (error) {
            console.error('Error fetching accounts:', error);
            debugLog('ไม่สามารถดึงข้อมูลบัญชีได้: ' + error.message, '#ff5555');
          }
        }

        async function fetchPhones() {
          try {
            const response = await fetch('/api/phones');
            if (!response.ok) throw new Error('Failed to fetch phones');
            const phones = await response.json();
            const tbody = document.querySelector('#phonesTable tbody');
            tbody.innerHTML = '';
            if (phones.length === 0) {
              tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">ยังไม่มีเบอร์ในระบบ</td></tr>';
            } else {
              phones.forEach(phone => {
                const tr = document.createElement('tr');
                tr.innerHTML = [
                  '<td>' + phone.rank + '</td>',
                  '<td>🌠 ' + phone.number + '</td>',
                  '<td><input type="text" class="edit-input" value="' + phone.name + '" onchange="editName(\\'' + phone.number + '\\', this.value)"></td>',
                  '<td>' + phone.earnings.toFixed(2) + '</td>',
                  '<td>📅 ' + (phone.expiresAt ? new Date(phone.expiresAt).toLocaleString('th-TH') : 'ไม่ระบุ') + '</td>',
                  '<td><button class="delete-btn" onclick="deletePhone(\\'' + phone.number + '\\')">🗑️ ลบ</button></td>'
                ].join('');
                tbody.appendChild(tr);
              });
            }
          } catch (error) {
            console.error('Error fetching phones:', error);
            debugLog('ไม่สามารถดึงข้อมูลเบอร์ได้: ' + error.message, '#ff5555');
          }
        }

        async function sendCode() {
          console.log('[DEBUG] Send code button clicked');
          const phone = document.getElementById('phoneInput').value.trim();
          if (!phone) {
            debugLog('กรุณาใส่เบอร์โทร!', '#ff5555');
            return;
          }
          console.log('[DEBUG] Phone entered:', phone);
          try {
            const response = await fetch('/api/send-code', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone })
            });
            const result = await response.json();
            if (response.ok) {
              debugLog(result.message, '#00ff00');
            } else {
              debugLog(result.error, '#ff5555');
            }
          } catch (error) {
            debugLog('การเชื่อมต่อ Telegram ล้มเหลว: ' + error.message, '#ff5555');
            console.error('Error in sendCode:', error);
          }
        }

        async function verifyCode() {
          console.log('[DEBUG] Verify code button clicked');
          const phone = document.getElementById('phoneInput').value.trim();
          const code = document.getElementById('codeInput').value.trim();
          const password = document.getElementById('passwordInput').value.trim();

          if (!phone || !code) {
            debugLog('กรุณาใส่เบอร์โทรและรหัสยืนยัน!', '#ff5555');
            return;
          }

          try {
            const response = await fetch('/api/verify-code', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone, code, password })
            });
            const result = await response.json();
            if (response.ok) {
              debugLog(result.message, '#00ff00');
              document.getElementById('phoneInput').value = '';
              document.getElementById('codeInput').value = '';
              document.getElementById('passwordInput').value = '';
              document.getElementById('passwordInput').style.display = 'none';
              fetchAccounts();
            } else {
              debugLog(result.error, '#ff5555');
              if (result.requiresPassword) {
                document.getElementById('passwordInput').style.display = 'block';
                debugLog('กรุณาใส่รหัสผ่าน 2FA!', '#ff5555');
              }
            }
          } catch (error) {
            debugLog('การเชื่อมต่อ Telegram ล้มเหลว: ' + error.message, '#ff5555');
            console.error('Error in verifyCode:', error);
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
              debugLog(result.message, '#00ff00');
              fetchPhones();
            } else {
              debugLog(result.error, '#ff5555');
            }
          } catch (error) {
            debugLog('เกิดข้อผิดพลาด: ' + error.message, '#ff5555');
          }
        }

        async function editName(phone, name) {
          try {
            const response = await fetch('/api/edit-phone-name', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone, name })
            });
            const result = await response.json();
            if (response.ok) {
              debugLog(result.message, '#00ff00');
              fetchPhones();
            } else {
              debugLog(result.error, '#ff5555');
            }
          } catch (error) {
            debugLog('เกิดข้อผิดพลาด: ' + error.message, '#ff5555');
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
              debugLog(result.message, '#00ff00');
              fetchAccounts();
            } else {
              debugLog(result.error, '#ff5555');
            }
          } catch (error) {
            debugLog('เกิดข้อผิดพลาด: ' + error.message, '#ff5555');
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

  setInterval(() => {
    loadOrCreatePhoneListFile();
    console.log(chalk.bgCyan.black.bold(` ⏰ ตรวจสอบเบอร์ที่หมดอายุเรียบร้อยแล้ว `));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] ⏰ ตรวจสอบเบอร์ที่หมดอายุเรียบร้อยแล้ว`, color: '#00ffcc' });
  }, 60000);

  app.listen(port, () => {
    console.log(chalk.bgMagenta.black.bold(` 🚀 ศูนย์บัญชาการอวกาศเริ่มทำงานที่ http://localhost:${port} `));
    botLogs.push({ text: `[${new Date().toLocaleTimeString()}] 🚀 ศูนย์บัญชาการอวกาศเริ่มทำงานที่ http://localhost:${port}`, color: '#ff00ff' });
  });
})();