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
// Reverted back to your original clean setup that allows smooth logins
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
let bootTime = Date.now(); // Uptime boot time saved

// Snipe Caches
const snipeCache = new Map();
const editSnipeCache = new Map();
const imageSnipeCache = new Map();

const autoReacts = new Map();
let packInterval = null; 
let loveInterval = null; // Interval cache for the love command

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const r = (message, text) => message.reply(`> ${text}`);

async function updatePresence(activities) {
  currentPresence = activities.map(act => typeof act.toJSON === 'function' ? act.toJSON() : act);
  try {
    await client.user.setPresence({ activities });
  } catch (err) {}
}

client.on('ready', () => {
  bootTime = Date.now(); // Reset time when bot is ready
  console.log(`Stealth mode active, logged into account: ${client.user.tag}`);
});

// ── DYNAMIC STATUS SYNC ───────────────────────────────────────────
// This catches whenever your account status changes globally and applies it directly
client.on('presenceUpdate', (oldPresence, newPresence) => {
  if (newPresence?.userId !== client.user.id) return;
  const newStatus = newPresence.clientStatus?.desktop || newPresence.status;
  if (newStatus) {
    client.user.setStatus(newStatus).catch(() => {});
  }
});

// Capture deleted messages (Snipe & Image Snipe)
client.on('messageDelete', (message) => {
  if (message.author?.id === client.user.id) return;

  // Normal Text Snipe
  if (message.content) {
    snipeCache.set(message.channel.id, {
      content: message.content,
      author: message.author?.tag || 'Unknown',
      deletedAt: new Date()
    });
  }

  // Image/Media Snipe
  if (message.attachments.size > 0) {
    const attachment = message.attachments.first();
    imageSnipeCache.set(message.channel.id, {
      url: attachment.proxyURL || attachment.url,
      author: message.author?.tag || 'Unknown',
      deletedAt: new Date()
    });
  }
});

// Capture edited messages (Edit Snipe)
client.on('messageUpdate', (oldMessage, newMessage) => {
  if (oldMessage.author?.id === client.user.id) return;
  if (oldMessage.content === newMessage.content) return;

  editSnipeCache.set(oldMessage.channel.id, {
    oldContent: oldMessage.content,
    newContent: newMessage.content,
    author: oldMessage.author?.tag || 'Unknown',
    editedAt: new Date()
  });
});

client.on('messageCreate', async (message) => {
  if (message.author.id !== client.user.id) return;
  if (!message.content.startsWith(',')) return; // Prefix set to ','

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ,ping
  if (command === 'ping') {
    const start = Date.now();
    const msg = await r(message, 'pinging...');
    await msg.edit(`> pong! ${Date.now() - start}ms | ws: ${client.ws.ping}ms`);
    return;
  }

  // ,uptime
  if (command === 'uptime') {
    const totalSecs = Math.floor((Date.now() - bootTime) / 1000);
    const days = Math.floor(totalSecs / 86400);
    const hours = Math.floor((totalSecs % 86400) / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    let uptimeStr = '';
    if (days > 0) uptimeStr += `${days} days `;
    if (hours > 0 || days > 0) uptimeStr += `${hours} hours `;
    if (mins > 0 || hours > 0 || days > 0) uptimeStr += `${mins} minutes `;
    uptimeStr += `${secs} seconds`;

    await r(message, `Bot uptime: **${uptimeStr}**`);
    return;
  }

  // ,afk
  if (command === 'afk') {
    if (!afk.active) {
      afk.active = true;
      afk.message = args.join(' ') || 'afk';
      afk.startTime = new Date();
      await r(message, `@${client.user.username}\n> AFK mode enabled: ${afk.message}`);
    } else {
      afk = { active: false, message: '', startTime: null };
      await r(message, `@${client.user.username}\n> AFK mode disabled`);
    }
    return;
  }

  // ,rpc
  if (command === 'rpc') {
    const input = args.join(' ');
    const subCommand = args[0]?.toLowerCase();

    if (!input || subCommand === 'off') {
      await updatePresence([]);
      return r(message, 'Streaming status turned off.');
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
          .setDetails('Live!');
        await updatePresence([defaultRpc]);
        return r(message, 'Default streaming status enabled.');
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

      let responseText = `Streaming status successfully updated:`;
      if (line1) responseText += `\n> **Line 1 (Name):** ${line1}`;
      if (line2) responseText += `\n> **Line 2 (Details):** ${line2}`;
      if (line3) responseText += `\n> **Line 3 (Status):** ${line3}`;
      if (bigImage) responseText += `\n> **Large Image:** ${bigImage}`;
      if (smallImage) responseText += `\n> **Small Image:** ${smallImage}`;
      
      await r(message, responseText);
    } catch (e) {
      await r(message, `An error occurred while setting RPC status: ${e.message}`);
    }
    return;
  }

  // ,avatar
  if (command === 'avatar') {
    const user = message.mentions.users.first();
    if (!user) return r(message, 'Usage: ,avatar @user');
    const url = user.displayAvatarURL({ dynamic: true, size: 1024 });
    await r(message, `${user.username}'s avatar — ${url}`);
    return;
  }

  // ,s
  if (command === 's') {
    const sniped = snipeCache.get(message.channel.id);
    if (!sniped) return r(message, 'There is no deleted text message in this channel.');
    const secsAgo = Math.floor((Date.now() - sniped.deletedAt) / 1000);
    const timeStr = secsAgo < 60 ? `${secsAgo}s ago` : `${Math.floor(secsAgo / 60)}m ago`;
    await r(message, `${sniped.author} (${timeStr}): ${sniped.content}`);
    return;
  }

  // ,es
  if (command === 'es') {
    const edited = editSnipeCache.get(message.channel.id);
    if (!edited) return r(message, 'There is no recently edited message in this channel.');
    const secsAgo = Math.floor((Date.now() - edited.editedAt) / 1000);
    const timeStr = secsAgo < 60 ? `${secsAgo}s ago` : `${Math.floor(secsAgo / 60)}m ago`;
    await r(message, `${edited.author} (${timeStr}):\n> **Old:** ${edited.oldContent}\n> **New:** ${edited.newContent}`);
    return;
  }

  // ,is
  if (command === 'is') {
    const imgSniped = imageSnipeCache.get(message.channel.id);
    if (!imgSniped) return r(message, 'No recently deleted image/media found in this channel.');
    const secsAgo = Math.floor((Date.now() - imgSniped.deletedAt) / 1000);
    const timeStr = secsAgo < 60 ? `${secsAgo}s ago` : `${Math.floor(secsAgo / 60)}m ago`;
    await r(message, `Image deleted by ${imgSniped.author} (${timeStr}):\n${imgSniped.url}`);
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
    const confirm = await message.channel.send(`> ${deleted} messages deleted`);
    setTimeout(() => confirm.delete().catch(() => {}), 3000);
    return;
  }

  // ,spam
  if (command === 'spam') {
    const delay = parseFloat(args[args.length - 1]) * 1000;
    const amount = parseInt(args[args.length - 2]);
    const text = args.slice(0, -2).join(' ');
    if (!text || isNaN(amount) || isNaN(delay)) return r(message, 'Usage: ,spam <text> <amount> <delay_seconds>');
    if (amount > 100) return r(message, 'Maximum limit is 100 messages');
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
    if (!words.length) return r(message, 'Usage: ,ladder <text>');
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
    if (!user) return r(message, 'Usage: ,react @user <emoji>');
    const emoji = message.content.replace(`,react`, '').replace(`<@${user.id}>`, '').replace(`<@!${user.id}>`, '').trim();
    if (!emoji) return r(message, 'Usage: ,react @user <emoji>');
    autoReacts.set(user.id, emoji);
    await r(message, `Will automatically react with ${emoji} to messages from ${user.username}`);
    return;
  }

  // ,sreact
  if (command === 'sreact') {
    if (args.length === 0 || !message.mentions.users.size) {
      autoReacts.clear();
      await r(message, 'All auto-reactions stopped');
    } else {
      const user = message.mentions.users.first();
      if (!autoReacts.has(user.id)) return r(message, `No active reaction found for ${user.username}`);
      autoReacts.delete(user.id);
      await r(message, `Auto-reaction turned off for ${user.username}`);
    }
    return;
  }

  // ,antigc
  if (command === 'antigc') {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'stop' || sub === 'off') {
      antiGc = false;
      await r(message, 'Anti-GC disabled');
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
    const extra = leftNow > 0 ? ` Left ${leftNow} group chats.` : '';
    await r(message, `Anti-GC enabled.${extra}\n> You will instantly leave any group chats you are added to.\n> To disable: ,antigc stop`);
    return;
  }

  // ,vc
  if (command === 'vc') {
    const link = args[0];

    if (!link) {
      if (!currentVC) return r(message, "I'm not in a voice channel right now");
      const shardId = message.guild?.shardId;
      if (shardId !== undefined) {
        const shard = client.ws.shards.get(shardId);
        if (shard) {
          shard.send({
            op: 4,
            d: { guild_id: message.guild.id, channel_id: null, self_mute: false, self_deaf: false }
          });
        }
      }
      currentVC = null;
      await r(message, 'Left the voice channel');
      return;
    }

    const match = link.match(/channels\/(\d+)\/(\d+)/);
    if (!match) return r(message, 'Usage: ,vc <channel link>');
    const [, guildId, channelId] = match;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return r(message, 'I am not in this server');
    const channel = guild.channels.cache.get(channelId);
    if (!channel || (channel.type !== 'GUILD_VOICE' && channel.type !== 2)) {
      return r(message, 'This is not a valid voice channel');
    }

    try {
      if (client.voice && client.voice.adapters) {
        client.voice.adapters.delete(guildId);
      }
      const shardId = guild.shardId;
      if (shardId !== undefined) {
        const shard = client.ws.shards.get(shardId);
        if (shard) {
          shard.send({
            op: 4,
            d: { guild_id: guildId, channel_id: channelId, self_mute: true, self_deaf: false, self_video: false, flags: 2 }
          });
        }
      }
      currentVC = channelId;
      await r(message, `Joined channel ${channel.name} and muted myself`);
    } catch (e) {
      await r(message, 'An error occurred while joining the voice channel');
    }
    return;
  }

  // ,pack
  if (command === 'pack') {
    if (packInterval) {
      return r(message, 'Pack is already running! To stop: ,spack');
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return r(message, 'Usage: ,pack @user (Please mention the user you want to target)');
    }

    const filePath = path.join(__dirname, 'pack.txt');
    if (!fs.existsSync(filePath)) {
      return r(message, 'pack.txt file not found. Please add the file to the bot folder.');
    }

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 0) {
      return r(message, 'pack.txt file is empty.');
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
      return r(message, 'No running pack process found.');
    }
    packInterval.stop();
    packInterval = null;
    await r(message, 'Pack process stopped.');
    return;
  }

  // ,love
  if (command === 'love') {
    if (loveInterval) {
      return r(message, 'Love process is already running! To stop: ,slove');
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return r(message, 'Usage: ,love @user (Please mention the user you want to send love messages to)');
    }

    const filePath = path.join(__dirname, 'love.txt');
    if (!fs.existsSync(filePath)) {
      return r(message, 'love.txt file not found. Please add the file to the bot folder.');
    }

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 0) {
      return r(message, 'love.txt file is empty.');
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
      return r(message, 'No running love process found.');
    }
    loveInterval.stop();
    loveInterval = null;
    await r(message, 'Love process stopped.');
    return;
  }

  // ,help
  if (command === 'help') {
    const art = "                      :::!~!!!!!:.\n                  .xUHWH!! !!?M88WHX:.\n                .X*#M@$!!  !X!M$$$$$$WWx:.\n               :!!!!!?H! :!$!$$$$$$$$$$8X:\n              !!~  ~:~!! :~!$!#$$$$$$$$$$8X:\n             :!~::!H!<   ~.U$X!?R$$$$$$$$MM!\n             ~!~!!!!~~ .:XW$$$U!!?$$$$$$RMM!\n               !:~~~ .:!M\"T#$$$$WX??#MRRMMM!\n               ~?WuxiW*`   `\"#$$$$8!!!!??!!!\n             :X- M$$$$       `\"T#$T~!8$WUXU~\n            :%`  ~#$$$m:        ~!~ ?$$$$$$\n          :!`.-   ~T$$$$8xx.  .444- ~\"\"##*\"\n.....   -~~:<\` !    ~?T#$$@@W@*?$$      /`\nW$@@M!!! .!~~ !!     .:XUW$W!~ `\"~:    :\n#\"~~\`.:x%\`!!  !H:   !WM$$$$Ti.: .!WUn+!\`\n:::~:!!\`:X~ .: ?H.!u \"$$$B$$$!W:U!T$$M~\n.~~   :X@!.-~   ?@WTWo(\"*$$$W$TH$! \`\nWi.~!X$?!-~    : ?$$$B$Wu(\"**$RM!\n$R@i.~~ !     :   ~$$$$$B$$en:\`\`\n?MXT@Wx.~    :     ~\"##*$$$$M~";
    
    const lines = [
      ',ping — Measures response latency',
      ',uptime — Shows how long the bot has been running',
      ',afk [message] — Toggles AFK mode on/off',
      ',rpc line1 | line2 | line3 | bigImg | smallImg — Custom streaming status (To close: ,rpc off)',
      ',avatar @user — Retrieves the user\'s avatar link',
      ',react @user <emoji> — Auto-adds an emoji reaction to the specified user\'s messages',
      ',sreact [@user] — Stops auto-reactions',
      ',s — Snipes the last deleted text message in the channel',
      ',es — Snipes the last edited message in the channel (Edit Snipe)',
      ',is — Snipes the last deleted image in the channel (Image Snipe)',
      ',ladder <text> — Drops words vertically like a ladder',
      ',spam <text> <amount> <delay> — Spams a specified amount of messages with a delay',
      ',antigc [stop] — Toggles auto-leaving group chats on/off',
      ',vc <link> — Joins/Leaves a voice channel',
      ',purge [1-100] — Mass deletes your own messages',
      ',pack @user — Sends random lines from pack.txt file',
      ',spack — Stops the pack process',
      ',love @user — Sends random lines from love.txt file',
      ',slove — Stops the love process',
    ].join('\n');
    
    await message.delete().catch(() => {});
    await message.channel.send(`\`\`\`\n${art}\n\`\`\``);
    await message.channel.send(`\`\`\`\n${lines}\n\`\`\``);
    return;
  }
});

// AFK Auto-Response System
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
    
    let timeStr = hours > 0 ? `${hours}h ${mins}m ${secs}s` : (mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
    await message.reply(`> ${client.user.username} is currently AFK.\n> Reason: ${afk.message}\n> Duration: ${timeStr}`).catch(() => {});
  }
});

// Auto-reaction listener
client.on('messageCreate', async (message) => {
  const emoji = autoReacts.get(message.author.id);
  if (!emoji) return;
  await message.react(emoji).catch(() => {});
});

// Anti-GC listener
client.on('channelCreate', async (channel) => {
  if (!antiGc) return;
  const t = channel.type;
  const isGC = t === 3 || t === 'GROUP_DM' || String(t) === '3';
  if (isGC) await channel.delete().catch(() => {});
});

process.on('unhandledRejection', () => {});

// Auto Mute protection (Max protection for null elements during initial client gateway sync)
client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState?.member?.id === client.user?.id && newState?.channelId) {
    if (!newState.selfMute) {
      const shardId = newState.guild?.shardId;
      if (shardId !== undefined) {
        const shard = client.ws.shards.get(shardId);
        if (shard) {
          shard.send({
            op: 4,
            d: { guild_id: newState.guild.id, channel_id: newState.channelId, self_mute: true, self_deaf: false, self_video: false }
          });
        }
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
