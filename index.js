require('dotenv').config();
const { Client, WebSocketShard, RichPresence } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

// ── USER CLIENT VR SPOOF CONFIG ───────────────────────────────────
const VR_PROPS = {
  os: 'Windows VR',
  browser: 'Discord VR',
  device: 'Quest',
  browser_user_agent: '',
  browser_version: '',
  os_version: '',
  referrer: '',
  referring_domain: '',
  referrer_current: '',
  referring_domain_current: '',
  release_channel: 'stable',
  client_build_number: 364899,
  client_event_source: null,
  design_id: 0,
  accessibility_support_enabled: false,
};

let currentPresence = null;

// ── RAW GATEWAY INJECTION ─────────────────────────────────────────
const _identify = WebSocketShard.prototype.identify;
WebSocketShard.prototype.identify = function () {
  const _send = this.send.bind(this);
  this.send = function (data) {
    if (data && data.op === 2) {
      data.d.properties = { ...VR_PROPS };
      data.d.capabilities = 16381;
      data.d.client_state = {
        guild_versions: {},
        highest_last_message_id: '0',
        read_state_version: 0,
        user_guild_settings_version: -1,
        user_settings_version: -1,
        private_channels_version: '0',
        api_code_version: 0,
      };
    }
    if (data && data.op === 3) {
      if (currentPresence) {
        data.d.activities = currentPresence;
      }
    }
    return _send(data);
  };
  return _identify.call(this);
};

const client = new Client({ checkUpdate: false });

let afk = { active: false, message: '', startTime: null };
let antiGc = false;
let currentVC = null;

// Snipe Caches
const snipeCache = new Map();
const editSnipeCache = new Map();
const imageSnipeCache = new Map();

const autoReacts = new Map();
let packInterval = null; 
let loveInterval = null; // Interval cache voor het love commando

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const r = (message, text) => message.reply(`> ${text}`);

async function updatePresence(activities) {
  currentPresence = activities.map(act => typeof act.toJSON === 'function' ? act.toJSON() : act);
  try {
    await client.user.setPresence({ activities });
  } catch (err) {}
}

client.on('ready', () => {
  console.log(`Gizli mod aktif, giriş yapılan hesap: ${client.user.tag}`);
});

// Silinen mesajları yakalama (Snipe & Image Snipe)
client.on('messageDelete', (message) => {
  if (message.author?.id === client.user.id) return;

  // Normal Metin Snipe
  if (message.content) {
    snipeCache.set(message.channel.id, {
      content: message.content,
      author: message.author?.tag || 'Bilinmiyor',
      deletedAt: new Date()
    });
  }

  // Görsel/Medya Snipe
  if (message.attachments.size > 0) {
    const attachment = message.attachments.first();
    imageSnipeCache.set(message.channel.id, {
      url: attachment.proxyURL || attachment.url,
      author: message.author?.tag || 'Bilinmiyor',
      deletedAt: new Date()
    });
  }
});

// Düzenlenen mesajları yakalama (Edit Snipe)
client.on('messageUpdate', (oldMessage, newMessage) => {
  if (oldMessage.author?.id === client.user.id) return;
  if (oldMessage.content === newMessage.content) return;

  editSnipeCache.set(oldMessage.channel.id, {
    oldContent: oldMessage.content,
    newContent: newMessage.content,
    author: oldMessage.author?.tag || 'Bilinmiyor',
    editedAt: new Date()
  });
});

client.on('messageCreate', async (message) => {
  if (message.author.id !== client.user.id) return;
  if (!message.content.startsWith(',')) return; // Prefix ',' yapıldı 

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ,ping
  if (command === 'ping') {
    const start = Date.now();
    const msg = await r(message, 'pingleniyor...');
    await msg.edit(`> pong! ${Date.now() - start}ms | ws: ${client.ws.ping}ms`);
    return;
  }

  // ,mail
  if (command === 'mail') {
    const targetGuildId = '1474557242966544406';
    const targetChannelId = '1515539973888278538';
    const botAppId = '1494426035293261986'; // Section App ID

    const guild = client.guilds.cache.get(targetGuildId);
    if (!guild) return r(message, 'Belirtilen sunucuda bulunmuyorum.');

    const channel = guild.channels.cache.get(targetChannelId);
    if (!channel) return r(message, 'Belirtilen kanal bulunamadı.');

    await r(message, 'E-posta oluşturuluyor, lütfen bekleyin...');

    try {
      // De user-account methode om de commands in dit specifieke kanaal te forceren
      // Dit vult de interne cache van de selfbot aan en voorkomt de 'null' en 'undefined' errors
      await channel.getSlashCommands().catch(() => {});
      
      // Verstuur de slash command interactie als user client
      await channel.sendSlash(botAppId, 'mail', [
        {
          name: 'domain',
          type: 'STRING',
          value: 'relapse.sbs'
        },
        {
          name: 'random_name',
          type: 'BOOLEAN',
          value: true
        }
      ]);
    } catch (err) {
      console.error('Slash komutu gönderilemedi:', err);
      await message.channel.send(`> Komut tetiklenirken hata oluştu: ${err.message}`);
    }
    return;
  }

  // ,afk
  if (command === 'afk') {
    if (!afk.active) {
      afk.active = true;
      afk.message = args.join(' ') || 'afk';
      afk.startTime = new Date();
      
      const afkStatus = new RichPresence(client)
        .setType('CUSTOM')
        .setName('Custom Status')
        .setState(`AFK: ${afk.message}`);

      await updatePresence([afkStatus]);
      await r(message, `@${client.user.username}\n> AFK modu açıldı: ${afk.message}`);
    } else {
      afk = { active: false, message: '', startTime: null };
      await updatePresence([]);
      await r(message, `@${client.user.username}\n> AFK modu kapatıldı`);
    }
    return;
  }

  // ,rpc
  if (command === 'rpc') {
    const input = args.join(' ');
    const subCommand = args[0]?.toLowerCase();

    if (!input || subCommand === 'off') {
      await updatePresence([]);
      return r(message, 'Yayın durumu kapatıldı.');
    }

    let cleanInput = input;
    if (subCommand === 'on') {
      cleanInput = input.slice(3).trim();
      if (!cleanInput) {
        const defaultRpc = new RichPresence(client)
          .setApplicationId('1424226835582947439')
          .setType('STREAMING')
          .setURL('https://twitch.tv/twitch')
          .setName('Twitch')
          .setDetails('Yayında!');
        await updatePresence([defaultRpc]);
        return r(message, 'Varsayılan yayın durumu aktifleştirildi.');
      }
    }

    const parts = cleanInput.split('|').map(p => p.trim());
    let textLines = [];
    let imageLinks = [];

    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('http://') || part.startsWith('https://')) {
        imageLinks.push(part);
      } else {
        textLines.push(part);
      }
    }

    let line1 = textLines[0] || null;
    let line2 = textLines[1] || null;
    let line3 = textLines[2] || null;
    let bigImage = imageLinks[0] || null;
    let smallImage = imageLinks[1] || null;

    try {
      const appId = '1424226835582947439'; 
      
      const pr = new RichPresence(client)
        .setApplicationId(appId)
        .setType('STREAMING')
        .setURL('https://twitch.tv/twitch');

      if (line1) pr.setName(line1);    
      if (line2) pr.setDetails(line2); 
      if (line3) pr.setState(line3);   

      const getAssetPath = async (url) => {
        if (!url) return null;
        let clean = url;
        if (clean.includes('imgur.com/') && !clean.match(/\.(jpeg|jpg|gif|png)$/)) {
          clean = clean.replace('imgur.com/', 'i.imgur.com/') + '.gif';
        }
        const res = await RichPresence.getExternal(client, appId, clean);
        return res && res[0] ? res[0].external_asset_path : null;
      };

      if (bigImage) {
        const bigAssetPath = await getAssetPath(bigImage);
        if (bigAssetPath) pr.setAssetsLargeImage(bigAssetPath);
      }

      if (smallImage) {
        const smallAssetPath = await getAssetPath(smallImage);
        if (smallAssetPath) pr.setAssetsSmallImage(smallAssetPath);
      }

      await updatePresence([pr]);

      let responseText = `Yayın durumu başarıyla ayarlandı:`;
      if (line1) responseText += `\n> **1. Satır (İsim):** ${line1}`;
      if (line2) responseText += `\n> **2. Satır (Detay):** ${line2}`;
      if (line3) responseText += `\n> **3. Satır (Durum):** ${line3}`;
      if (bigImage) responseText += `\n> **Büyük Görsel:** ${bigImage}`;
      if (smallImage) responseText += `\n> **Küçük Görsel:** ${smallImage}`;
      
      await r(message, responseText);
    } catch (e) {
      await r(message, `RPC durumu ayarlanırken hata oluştu: ${e.message}`);
    }
    return;
  }

  // ,say
  if (command === 'say') {
    const text = args.join(' ');
    if (!text) return r(message, 'kullanım: -say <metin>');
    await message.delete().catch(() => {});
    await message.channel.send(`> ${text}`);
    return;
  }

  // ,ghost
  if (command === 'ghost') {
    const text = args.join(' ');
    if (!text) return r(message, 'kullanım: -ghost <metin>');
    await message.delete().catch(() => {});
    const sent = await message.channel.send(`> ${text}`);
    await sleep(1500);
    await sent.delete().catch(() => {});
    return;
  }

  // ,mock
  if (command === 'mock') {
    const text = args.join(' ');
    if (!text) return r(message, 'kullanım: -mock <metin>');
    const mocked = text.split('').map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join('');
    await message.delete().catch(() => {});
    await message.channel.send(`${mocked}`);
    return;
  }

  // ,reverse
  if (command === 'reverse') {
    const text = args.join(' ');
    if (!text) return r(message, 'kullanım: -reverse <metin>');
    await message.delete().catch(() => {});
    await message.channel.send(`> ${text.split('').reverse().join('')}`);
    return;
  }

  // ,copy
  if (command === 'copy') {
    const user = message.mentions.users.first();
    if (!user) return r(message, 'kullanım: -copy @kullanıcı');
    const fetched = await message.channel.messages.fetch({ limit: 50 });
    const target = fetched.filter(m => m.author.id === user.id && m.content).first();
    if (!target) return r(message, 'Bu kullanıcıdan yakın zamanda mesaj bulunamadı');
    await message.delete().catch(() => {});
    await message.channel.send(`> ${target.content}`);
    return;
  }

  // ,steal
  if (command === 'steal') {
    const emojiArg = args[0];
    if (!emojiArg) return r(message, 'kullanım: -steal <emoji>');
    const match = emojiArg.match(/<(?:a)?:(\w+):(\d+)>/);
    if (!match) return r(message, 'Bu özel bir emoji değil');
    const ext = emojiArg.startsWith('<a:') ? 'gif' : 'png';
    const url = `https://cdn.discordapp.com/emojis/${match[2]}.${ext}?size=1024`;
    await r(message, `${match[1]} — ${url}`);
    return;
  }

  // ,avatar
  if (command === 'avatar') {
    const user = message.mentions.users.first();
    if (!user) return r(message, 'kullanım: -avatar @kullanıcı');
    const url = user.displayAvatarURL({ dynamic: true, size: 1024 });
    await r(message, `${user.username} adlı kullanıcının avatarı — ${url}`);
    return;
  }

  // ,s
  if (command === 's') {
    const sniped = snipeCache.get(message.channel.id);
    if (!sniped) return r(message, 'Bu kanalda silinmiş bir metin mesajı yok.');
    const secsAgo = Math.floor((Date.now() - sniped.deletedAt) / 1000);
    const timeStr = secsAgo < 60 ? `${secsAgo}sn önce` : `${Math.floor(secsAgo / 60)}dk önce`;
    await r(message, `${sniped.author} (${timeStr}): ${sniped.content}`);
    return;
  }

  // ,es
  if (command === 'es') {
    const edited = editSnipeCache.get(message.channel.id);
    if (!edited) return r(message, 'Bu kanalda yakın zamanda düzenlenen bir mesaj yok.');
    const secsAgo = Math.floor((Date.now() - edited.editedAt) / 1000);
    const timeStr = secsAgo < 60 ? `${secsAgo}sn önce` : `${Math.floor(secsAgo / 60)}dk önce`;
    await r(message, `${edited.author} (${timeStr}):\n> **Eski:** ${edited.oldContent}\n> **Yeni:** ${edited.newContent}`);
    return;
  }

  // ,is
  if (command === 'is') {
    const imgSniped = imageSnipeCache.get(message.channel.id);
    if (!imgSniped) return r(message, 'Bu kanalda yakın zamanda silinen bir görsel/medya bulunamadı.');
    const secsAgo = Math.floor((Date.now() - imgSniped.deletedAt) / 1000);
    const timeStr = secsAgo < 60 ? `${secsAgo}sn önce` : `${Math.floor(secsAgo / 60)}dk önce`;
    await r(message, `${imgSniped.author} (${timeStr}) tarafından silinen görsel:\n${imgSniped.url}`);
    return;
  }

  // ,purge
  if (command === 'purge') {
    const amount = Math.min(parseInt(args[0]) || 10, 100);
    const fetched = await message.channel.messages.fetch({ limit: 100 });
    const mine = [...fetched.filter(m => m.author.id === client.user.id).values()].slice(0, amount);
    let deleted = 0;
    for (const msg of mine) {
      await msg.delete().catch(() => {});
      deleted++;
      await sleep(350);
    }
    const confirm = await message.channel.send(`> ${deleted} mesaj silindi`);
    setTimeout(() => confirm.delete().catch(() => {}), 3000);
    return;
  }

  // ,spam
  if (command === 'spam') {
    const delay = parseFloat(args[args.length - 1]) * 1000;
    const amount = parseInt(args[args.length - 2]);
    const text = args.slice(0, -2).join(' ');
    if (!text || isNaN(amount) || isNaN(delay)) return r(message, 'kullanım: -spam <metin> <miktar> <gecikme saniye>');
    if (amount > 100) return r(message, 'Maksimum 100 mesaj sınırı var');
    await message.delete().catch(() => {});
    for (let i = 0; i < amount; i++) {
      await message.channel.send(`> ${text}`);
      await sleep(delay);
    }
    return;
  }

  // ,ladder
  if (command === 'ladder') {
    const words = args;
    if (!words.length) return r(message, 'kullanım: -ladder <metin>');
    await message.delete().catch(() => {});
    for (const word of words) {
      await message.channel.send(`${word}`);
      await sleep(500);
    }
    return;
  }

  // ,react
  if (command === 'react') {
    const user = message.mentions.users.first();
    if (!user) return r(message, 'kullanım: -react @kullanıcı <emoji>');
    const emoji = message.content.replace(`-react`, '').replace(`<@${user.id}>`, '').replace(`<@!${user.id}>`, '').trim();
    if (!emoji) return r(message, 'kullanım: -react @kullanıcı <emoji>');
    autoReacts.set(user.id, emoji);
    await r(message, `${user.username} adlı kullanıcının mesajlarına otomatik olarak ${emoji} tepkisi verilecek`);
    return;
  }

  // ,sreact
  if (command === 'sreact') {
    if (args.length === 0 || !message.mentions.users.size) {
      autoReacts.clear();
      await r(message, 'Tüm otomatik tepkiler durduruldu');
    } else {
      const user = message.mentions.users.first();
      if (!autoReacts.has(user.id)) return r(message, `${user.username} için aktif tepki bulunamadı`);
      autoReacts.delete(user.id);
      await r(message, `${user.username} için otomatik tepki kapatıldı`);
    }
    return;
  }

  // ,antigc
  if (command === 'antigc') {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'stop' || sub === 'off') {
      antiGc = false;
      await r(message, 'Anti-GC kapatıldı');
      return;
    }
    antiGc = true;
    let leftNow = 0;
    for (const [, ch] of client.channels.cache) {
      const t = ch.type;
      const isGC = t === 3 || t === 'GROUP_DM' || String(t) === '3';
      if (isGC) {
        await ch.delete().catch(() => {});
        leftNow++;
      }
    }
    const extra = leftNow > 0 ? ` ${leftNow} grup sohbetinden çıkıldı.` : '';
    await r(message, `Anti-GC açıldı.${extra}\n> Eklendiğiniz grup sohbetlerinden anında ayrılacaksınız.\n> Kapatmak için: -antigc stop`);
    return;
  }

  // ,vc
  if (command === 'vc') {
    const link = args[0];

    if (!link) {
      if (!currentVC) return r(message, 'Şu an bir ses kanalında değilim');
      message.guild.shard.send({
        op: 4,
        d: { guild_id: message.guild.id, channel_id: null, self_mute: false, self_deaf: false }
      });
      currentVC = null;
      await r(message, 'Ses kanalından ayrıldım');
      return;
    }

    const match = link.match(/channels\/(\d+)\/(\d+)/);
    if (!match) return r(message, 'kullanım: -vc <kanal linki>');
    const [, guildId, channelId] = match;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return r(message, 'Bu sunucuda bulunmuyorum');
    const channel = guild.channels.cache.get(channelId);
    if (!channel || (channel.type !== 'GUILD_VOICE' && channel.type !== 2)) {
      return r(message, 'Bu geçerli bir ses kanalı değil');
    }

    try {
      if (client.voice && client.voice.adapters) {
        client.voice.adapters.delete(guildId);
      }
      guild.shard.send({
        op: 4,
        d: { guild_id: guildId, channel_id: channelId, self_mute: true, self_deaf: false, self_video: false, flags: 2 }
      });
      currentVC = channelId;
      await r(message, `${channel.name} kanalına katıldım ve kendimi susturdum (Mute)`);
    } catch (e) {
      await r(message, 'Ses kanalına katılırken bir hata oluştu');
    }
    return;
  }

  // ,pack
  if (command === 'pack') {
    if (packInterval) {
      return r(message, 'Pack zaten çalışıyor! Durdurmak için: -spack');
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return r(message, 'kullanım: -pack @user (Lütfen pinglemek istediğiniz kullanıcıyı etiketleyin)');
    }

    const filePath = path.join(__dirname, 'pack.txt');
    if (!fs.existsSync(filePath)) {
      return r(message, 'pack.txt dosyası bulunamadı. Lütfen botun olduğu klasöre dosyayı ekleyin.');
    }

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 0) {
      return r(message, 'pack.txt dosyası boş.');
    }

    await message.delete().catch(() => {});

    let isRunning = true;
    packInterval = true; 

    const sendLoop = async () => {
      while (isRunning && packInterval) {
        const randomLine = lines[Math.floor(Math.random() * lines.length)];
        
        try {
          await message.channel.sendTyping().catch(() => {});
          await sleep(Math.floor(Math.random() * 150) + 50);
          await message.channel.send(`# ${randomLine} <@${targetUser.id}>`);
        } catch (err) {}

        const randomizedDelay = Math.floor(Math.random() * 250) + 400; 
        await sleep(randomizedDelay);
      }
    };

    packInterval = {
      stop: () => { 
        isRunning = false; 
      }
    };

    sendLoop();
    return;
  }

  // ,spack
  if (command === 'spack') {
    if (!packInterval || typeof packInterval.stop !== 'function') {
      return r(message, 'Çalışan bir pack işlemi bulunamadı.');
    }
    packInterval.stop();
    packInterval = null;
    await r(message, 'Pack işlemi durduruldu.');
    return;
  }

  // ,love
  if (command === 'love') {
    if (loveInterval) {
      return r(message, 'Love işlemi zaten çalışıyor! Durdurmak için: -slove');
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return r(message, 'kullanım: -love @user (Lütfen sevgi mesajı göndermek istediğiniz kullanıcıyı etiketleyin)');
    }

    const filePath = path.join(__dirname, 'love.txt');
    if (!fs.existsSync(filePath)) {
      return r(message, 'love.txt dosyası bulunamadı. Lütfen botun olduğu klasöre dosyayı ekleyin.');
    }

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 0) {
      return r(message, 'love.txt dosyası boş.');
    }

    await message.delete().catch(() => {});

    let isRunning = true;
    loveInterval = true; 

    const sendLoop = async () => {
      while (isRunning && loveInterval) {
        const randomLine = lines[Math.floor(Math.random() * lines.length)];
        
        try {
          await message.channel.sendTyping().catch(() => {});
          await sleep(Math.floor(Math.random() * 150) + 50);
          await message.channel.send(`# ${randomLine} <@${targetUser.id}>`);
        } catch (err) {}

        const randomizedDelay = Math.floor(Math.random() * 250) + 400; 
        await sleep(randomizedDelay);
      }
    };

    loveInterval = {
      stop: () => { 
        isRunning = false; 
      }
    };

    sendLoop();
    return;
  }

  // ,slove
  if (command === 'slove') {
    if (!loveInterval || typeof loveInterval.stop !== 'function') {
      return r(message, 'Çalışan bir love işlemi bulunamadı.');
    }
    loveInterval.stop();
    loveInterval = null;
    await r(message, 'Love işlemi durduruldu.');
    return;
  }

  // ,help
  if (command === 'help') {
    const art = "                      :::!~!!!!!:.\n                  .xUHWH!! !!?M88WHX:.\n                .X*#M@$!!  !X!M$$$$$$WWx:.\n               :!!!!!!?H! :!$!$$$$$$$$$$8X:\n              !!~  ~:~!! :~!$!#$$$$$$$$$$8X:\n             :!~::!H!<   ~.U$X!?R$$$$$$$$MM!\n             ~!~!!!!~~ .:XW$$$U!!?$$$$$$RMM!\n               !:~~~ .:!M\"T#$$$$WX??#MRRMMM!\n               ~?WuxiW*`   `\"#$$$$8!!!!??!!!\n             :X- M$$$$       `\"T#$T~!8$WUXU~\n            :%`  ~#$$$m:        ~!~ ?$$$$$$\n          :!`.-   ~T$$$$8xx.  .444- ~\"\"##*\"\n.....   -~~:<\` !    ~?T#$$@@W@*?$$      /`\nW$@@M!!! .!~~ !!     .:XUW$W!~ `\"~:    :\n#\"~~\`.:x%\`!!  !H:   !WM$$$$Ti.: .!WUn+!\`\n:::~:!!\`:X~ .: ?H.!u \"$$$B$$$!W:U!T$$M~\n.~~   :X@!.-~   ?@WTWo(\"*$$$W$TH$! \`\nWi.~!X$?!-~    : ?$$$B$Wu(\"**$RM!\n$R@i.~~ !     :   ~$$$$$B$$en:\`\`\n?MXT@Wx.~    :     ~\"##*$$$$M~";
    
    const lines = [
      ',ping — Gecikme süresini ölçer',
      ',mail — Otomatik geçici e-posta adresi oluşturur',
      ',afk [mesaj] — AFK modunu açar/kapatır',
      ',rpc satır1 | satır2 | satır3 | bigImg | smallImg — Özel yayın durumu (Kapatmak için: ,rpc off)',
      ',say <metin> — Mesajı normal gönderir',
      ',ghost <metin> — Mesajı gönderir ve anında siler',
      ',mock <metin> — sPoNgEbOb tarzı yazı yazar',
      ',reverse <metin> — Metni tersine çevirir',
      ',copy @kullanici — Kullanıcının son mesajını kopyalar',
      ',steal <emoji> — Özel emojinin linkini alır',
      ',avatar @kullanici — Kullanıcının avatar linkini alır',
      ',react @kullanici <emoji> — Belirtilen kullanıcının mesajlarına otomatik emoji ekler',
      ',sreact [@kullanici] — Otomatik emojiyi durdurur',
      ',s — Kanaldaki son silinen metin mesajını yakalar (Snipe)',
      ',es — Kanaldaki son düzenlenen mesajı yakalar (Edit Snipe)',
      ',is — Kanaldaki son silinen görseli yakalar (Image Snipe)',
      ',ladder <metin> — Kelimeleri merdiven şeklinde alt alta atar',
      ',spam <metin> <miktar> <gecikme> — Belirtilen miktarda mesaj spamlar',
      ',antigc [stop] — Gruplardan otomatik çıkmayı açar/kapatır',
      ',vc <link> — Ses kanalına giriş yapar/ayrılır',
      ',purge [1-100] — Kendi mesajlarınızı toplu siler',
      ',pack @user — pack.txt dosyasından rastgele satırları gönderir',
      ',spack — pack işlemini durdurur',
      ',love @user — love.txt dosyasından rastgele satırları gönderir',
      ',slove — love işlemini durdurur',
    ].join('\n');
    
    await message.delete().catch(() => {});
    await message.channel.send(`\`\`\`\n${art}\n\`\`\``);
    await message.channel.send(`\`\`\`\n${lines}\n\`\`\``);
    return;
  }
});

// AFK Otomatik Yanıt Sistemi
const afkCooldown = new Map();
client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;
  if (!afk.active) return;
  const isMentioned = message.mentions.has(client.user.id);
  const isDM = message.channel.type === 'DM';
  if (isMentioned || isDM) {
    const last = afkCooldown.get(message.author.id) || 0;
    if (Date.now() - last < 10000) return;
    afkCooldown.set(message.author.id, Date.now());
    
    const totalSecs = Math.floor((Date.now() - afk.startTime) / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    
    let timeStr = hours > 0 ? `${hours}sa ${mins}dk ${secs}sn` : (mins > 0 ? `${mins}dk ${secs}sn` : `${secs}sn`);
    await message.reply(`> ${client.user.username} şu anda AFK modunda.\n> Sebep: ${afk.message}\n> Süre: ${timeStr}`).catch(() => {});
  }
});

// Otomatik tepki listener'ı
client.on('messageCreate', async (message) => {
  const emoji = autoReacts.get(message.author.id);
  if (!emoji) return;
  await message.react(emoji).catch(() => {});
});

// Anti-GC listener'ı
client.on('channelCreate', async (channel) => {
  if (!antiGc) return;
  const t = channel.type;
  const isGC = t === 3 || t === 'GROUP_DM' || String(t) === '3';
  if (isGC) await channel.delete().catch(() => {});
});

process.on('unhandledRejection', () => {});

// Otomatik Mute koruması
client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.member.id === client.user.id && newState.channelId) {
    if (!newState.selfMute) {
      newState.guild.shard.send({
        op: 4,
        d: { guild_id: newState.guild.id, channel_id: newState.channelId, self_mute: true, self_deaf: false, self_video: false }
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
