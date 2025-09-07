require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Events, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');

const VERIFY_CHANNEL_NAME = process.env.VERIFY_CHANNEL_NAME || 'verify';
const LOG_CHANNEL_NAME = process.env.LOG_CHANNEL_NAME || 'welcome-log';
const MEMBER_ROLE_NAME = process.env.MEMBER_ROLE_NAME || 'Member';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember]
});

// ฟังก์ชันสร้างภาพ welcome/leave แบบเรียบง่าย
async function createImage(member, type = 'welcome') {
  const canvas = createCanvas(500, 300);
  const ctx = canvas.getContext('2d');

  // พื้นหลังสีดำ
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    // avatar
    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const avatar = await loadImage(avatarURL);
    
    // วาดรูป avatar แบบวงกลม (กลางภาพ)
    const centerX = canvas.width / 2;
    const centerY = 120;
    const radius = 70;
    
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, centerX - radius, centerY - radius, radius * 2, radius * 2);
    ctx.restore();
    
    // วาดกรอบรอบ avatar (สีขาว)
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
    ctx.stroke();
  } catch (error) {
    // หากโหลด avatar ไม่ได้ ให้วาดวงกลมเปล่า
    const centerX = canvas.width / 2;
    const centerY = 120;
    const radius = 70;
    
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
    ctx.stroke();
  }

  // ข้อความหลัก (กลางภาพ)
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  
  if (type === 'welcome') {
    ctx.fillText('WELCOME', canvas.width / 2, 230);
  } else {
    ctx.fillText('GOODBYE', canvas.width / 2, 230);
  }

  // ชื่อผู้ใช้ (ใต้ข้อความหลัก)
  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#CCCCCC';
  ctx.fillText(member.user.username, canvas.width / 2, 260);

  return new AttachmentBuilder(canvas.toBuffer(), { name: `${type}.png` });
}

// เมื่อบอทออนไลน์
client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} is online.`);

  for (const guild of client.guilds.cache.values()) {
    try {
      // สร้าง role Member ถ้าไม่มี
      let role = guild.roles.cache.find(r => r.name === MEMBER_ROLE_NAME);
      if (!role) {
        role = await guild.roles.create({
          name: MEMBER_ROLE_NAME,
          reason: 'สร้าง role สำหรับสมาชิกที่ยืนยันแล้ว'
        });
        console.log(`สร้าง role ${MEMBER_ROLE_NAME} ใน ${guild.name}`);
      }

      // หา channel verify
      const vchan = guild.channels.cache.find(c =>
        c.name === VERIFY_CHANNEL_NAME && c.type === ChannelType.GuildText
      );
      if (!vchan) continue;

      // ตรวจสอบว่ามีปุ่มอยู่แล้วหรือยัง
      const msgs = await vchan.messages.fetch({ limit: 20 });
      const hasVerify = msgs.some(m =>
        m.components?.some(row =>
          row.components?.some(comp => comp.customId === 'verify_btn')
        )
      );

      if (!hasVerify) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('verify_btn')
            .setLabel('✅ ยืนยันตัวตน')
            .setStyle(ButtonStyle.Success)
        );

        await vchan.send({
          content: `กดปุ่มด้านล่างเพื่อยืนยันและรับ role **${MEMBER_ROLE_NAME}**`,
          components: [row]
        });
      }
    } catch (err) {
      console.error(`setup error for guild ${guild.name}`, err);
    }
  }
});

// เมื่อมีคนเข้าร่วม
client.on(Events.GuildMemberAdd, async member => {
  const logCh = member.guild.channels.cache.find(c =>
    c.name === LOG_CHANNEL_NAME && c.type === ChannelType.GuildText
  ) || member.guild.systemChannel;
  if (!logCh) return;

  try {
    const img = await createImage(member, 'welcome');
    await logCh.send({ files: [img] });
  } catch (error) {
    console.error('Error creating welcome image:', error);
  }
});

// เมื่อมีคนออก
client.on(Events.GuildMemberRemove, async member => {
  const logCh = member.guild.channels.cache.find(c =>
    c.name === LOG_CHANNEL_NAME && c.type === ChannelType.GuildText
  ) || member.guild.systemChannel;
  if (!logCh) return;

  try {
    const img = await createImage(member, 'leave');
    await logCh.send({ files: [img] });
  } catch (error) {
    console.error('Error creating leave image:', error);
  }
});

// ปุ่มยืนยัน
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'verify_btn') return;
  if (interaction.member.user.bot) {
    return interaction.reply({ content: 'บอทไม่สามารถยืนยันได้', ephemeral: true });
  }

  const role = interaction.guild.roles.cache.find(r => r.name === MEMBER_ROLE_NAME);
  if (!role) {
    return interaction.reply({ content: `ไม่พบ role "${MEMBER_ROLE_NAME}"`, ephemeral: true });
  }

  await interaction.member.roles.add(role);
  await interaction.reply({ content: `✅ ยืนยันเรียบร้อย! คุณได้รับ role **${MEMBER_ROLE_NAME}**`, ephemeral: true });
});

client.login(process.env.BOT_TOKEN);