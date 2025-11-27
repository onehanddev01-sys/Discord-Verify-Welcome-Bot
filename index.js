require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Events, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const express = require('express');
const cors = require('cors');
const path = require('path');

let config = {
  VERIFY_CHANNEL_NAME: process.env.VERIFY_CHANNEL_NAME || 'verify',
  LOG_CHANNEL_NAME: process.env.LOG_CHANNEL_NAME || 'welcome-log',
  MEMBER_ROLE_NAME: process.env.MEMBER_ROLE_NAME || 'Member',
  VERIFY_BUTTON_TEXT: process.env.VERIFY_BUTTON_TEXT || 'ยืนยันตัวต',
  VERIFY_MESSAGE: process.env.VERIFY_MESSAGE || 'กดปุ่มด้านล่างเพื่อยืนยันและรับ role',
  SUCCESS_MESSAGE: process.env.SUCCESS_MESSAGE || '✅ ยืนยันเรียบร้อย! คุณได้รับ role'
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember]
});

// Web Server Setup
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/config', (req, res) => {
  res.json(config);
});

app.post('/api/config', async (req, res) => {
  try {
    const newConfig = req.body;
    
    // Validate input
    if (!newConfig.VERIFY_CHANNEL_NAME || !newConfig.LOG_CHANNEL_NAME || 
        !newConfig.MEMBER_ROLE_NAME || !newConfig.VERIFY_BUTTON_TEXT) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }

    // Update config
    config = { ...config, ...newConfig };
    
    // Restart verification setup for all guilds
    await setupVerificationForAllGuilds();
    
    res.json({ success: true, message: 'อัปเดตการตั้งค่าเรียบร้อย' });
  } catch (error) {
    console.error('Config update error:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการอัปเดต' });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    botOnline: client.isReady(),
    username: client.user?.username || 'ไม่ทราบ',
    guilds: client.guilds.cache.size,
    uptime: process.uptime()
  });
});

// ฟังก์ชันสร้างภาพ welcome/leave
async function createImage(member, type = 'welcome') {
  const canvas = createCanvas(500, 300);
  const ctx = canvas.getContext('2d');

  // พื้นหลังไล่สี
  const gradient = ctx.createLinearGradient(0, 0, 500, 300);
  if (type === 'welcome') {
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
  } else {
    gradient.addColorStop(0, '#ff7e5f');
    gradient.addColorStop(1, '#feb47b');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    // Load and draw avatar
    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const avatar = await loadImage(avatarURL);
    
    const centerX = canvas.width / 2;
    const centerY = 120;
    const radius = 70;
    
    // Avatar circle with border
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, centerX - radius, centerY - radius, radius * 2, radius * 2);
    ctx.restore();
    
    // White border
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
    ctx.stroke();
  } catch (error) {
    // Default avatar if loading fails
    const centerX = canvas.width / 2;
    const centerY = 120;
    const radius = 70;
    
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
    ctx.fill();
    
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Main text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 10;
  
  const mainText = type === 'welcome' ? 'WELCOME' : 'GOODBYE';
  ctx.fillText(mainText, canvas.width / 2, 230);

  // Username
  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#F0F0F0';
  ctx.fillText(member.user.username, canvas.width / 2, 260);

  return new AttachmentBuilder(canvas.toBuffer(), { name: `${type}.png` });
}


async function setupVerificationForAllGuilds() {
  for (const guild of client.guilds.cache.values()) {
    try {
      // Create Member role if not exists
      let role = guild.roles.cache.find(r => r.name === config.MEMBER_ROLE_NAME);
      if (!role) {
        role = await guild.roles.create({
          name: config.MEMBER_ROLE_NAME,
          reason: 'สร้าง role สำหรับสมาชิกที่ยืนยันแล้ว'
        });
        console.log(`สร้าง role ${config.MEMBER_ROLE_NAME} ใน ${guild.name}`);
      }

      // Find verify channel
      const vchan = guild.channels.cache.find(c =>
        c.name === config.VERIFY_CHANNEL_NAME && c.type === ChannelType.GuildText
      );
      if (!vchan) continue;

      // Clear old verification messages
      const msgs = await vchan.messages.fetch({ limit: 50 });
      const botMsgs = msgs.filter(m => m.author.id === client.user.id);
      for (const msg of botMsgs.values()) {
        try {
          await msg.delete();
        } catch (e) { /* ignore */ }
      }

      // Send new verification message
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('verify_btn')
          .setLabel(config.VERIFY_BUTTON_TEXT)
          .setStyle(ButtonStyle.Success)
      );

      await vchan.send({
        content: `${config.VERIFY_MESSAGE} **${config.MEMBER_ROLE_NAME}**`,
        components: [row]
      });

    } catch (err) {
      console.error(`Setup error for guild ${guild.name}:`, err);
    }
  }
}

// Bot Events
client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} is online and ready!`);
  await setupVerificationForAllGuilds();

  app.listen(PORT, () => {
    console.log(`🌐 Web panel running on http://localhost:${PORT}`);
  });
});

client.on(Events.GuildMemberAdd, async member => {
  const logCh = member.guild.channels.cache.find(c =>
    c.name === config.LOG_CHANNEL_NAME && c.type === ChannelType.GuildText
  ) || member.guild.systemChannel;
  if (!logCh) return;

  try {
    const img = await createImage(member, 'welcome');
    await logCh.send({ files: [img] });
  } catch (error) {
    console.error('Error creating welcome image:', error);
  }
});

client.on(Events.GuildMemberRemove, async member => {
  const logCh = member.guild.channels.cache.find(c =>
    c.name === config.LOG_CHANNEL_NAME && c.type === ChannelType.GuildText
  ) || member.guild.systemChannel;
  if (!logCh) return;

  try {
    const img = await createImage(member, 'leave');
    await logCh.send({ files: [img] });
  } catch (error) {
    console.error('Error creating leave image:', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'verify_btn') return;
  if (interaction.member.user.bot) {
    return interaction.reply({ content: 'บอทไม่สามารถยืนยันได้', ephemeral: true });
  }

  const role = interaction.guild.roles.cache.find(r => r.name === config.MEMBER_ROLE_NAME);
  if (!role) {
    return interaction.reply({ content: `ไม่พบ role "${config.MEMBER_ROLE_NAME}"`, ephemeral: true });
  }

  await interaction.member.roles.add(role);
  await interaction.reply({ 
    content: `${config.SUCCESS_MESSAGE} **${config.MEMBER_ROLE_NAME}**`, 
    ephemeral: true 
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  client.destroy();
  process.exit(0);
});

client.login(process.env.BOT_TOKEN);
