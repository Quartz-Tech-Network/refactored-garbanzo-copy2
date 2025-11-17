const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;

const express = require('express');
const fs = require('fs');
const config = require('./settings.json');

function createBot() {
  const bot = mineflayer.createBot({
    username: config['bot-account']['username'],
    password: config['bot-account']['password'],
    auth: config['bot-account']['type'],
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version,
  });
  bot.loadPlugin(pathfinder);

  const mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);

  bot.settings.colorsEnabled = false;

  let pendingPromise = Promise.resolve();

  function sendRegister(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/register ${password} ${password}`);
      console.log(`[Auth] Sent /register`);

      const onMessage = (msg) => {
        const message = msg.toString();
        console.log(`[AuthLog] ${message}`);
        if (message.includes('successfully registered')) {
          bot.removeListener('message', onMessage);
          resolve();
        } else if (message.includes('already registered')) {
          bot.removeListener('message', onMessage);
          resolve();
        } else {
          // Not the one we expected — ignore until timeout
        }
      };
      bot.on('message', onMessage);

      // Timeout after, say, 10 seconds if nothing happened
      setTimeout(() => {
        bot.removeListener('message', onMessage);
        reject(`[Register ERROR] No register response after timeout`);
      }, 10000);
    });
  }

  function sendLogin(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/login ${password}`);
      console.log(`[Auth] Sent /login`);
      const onMessage = (msg) => {
        const message = msg.toString();
        console.log(`[AuthLog] ${message}`);
        if (message.includes('successfully logged in')) {
          bot.removeListener('message', onMessage);
          resolve();
        } else if (message.includes('Invalid password')) {
          bot.removeListener('message', onMessage);
          reject(`[Login ERROR] Invalid password. Message: "${message}"`);
        } else if (message.includes('not registered')) {
          bot.removeListener('message', onMessage);
          reject(`[Login ERROR] Not registered. Message: "${message}"`);
        } else {
          // ignore others
        }
      };
      bot.on('message', onMessage);

      setTimeout(() => {
        bot.removeListener('message', onMessage);
        reject(`[Login ERROR] No login response after timeout`);
      }, 10000);
    });
  }

  bot.once('spawn', () => {
    console.log('[AfkBot] Bot joined the server');

    if (config.utils['auto-auth'].enabled) {
      console.log('[INFO] Started auto-auth module');
      const password = config.utils['auto-auth'].password;
      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch(error => {
          console.error('[ERROR] Auth failed:', error);
          bot.end();  // Trigger reconnect
        });
    }

    if (config.position.enabled) {
      const pos = config.position;
      console.log(`[AfkBot] Moving to target ${pos.x}, ${pos.y}, ${pos.z}`);
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    if (config.utils['anti-afk'].enabled) {
      console.log('[INFO] Started anti-afk module');
      setInterval(() => {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);

        if (config.utils['anti-afk'].sneak) {
          bot.setControlState('sneak', true);
          setTimeout(() => bot.setControlState('sneak', false), 500);
        }
      }, 10000);
    }
  });

  bot.on('goal_reached', () => {
    console.log(`[AfkBot] Goal reached: ${bot.entity.position}`);
  });

  bot.on('death', () => {
    console.log(`[AfkBot] Died and respawned at ${bot.entity.position}`);
  });

  // Reconnect logic with exponential backoff
  let reconnectAttempts = 0;
  const maxReconnect = config.utils['max-reconnect-attempts'] ?? 10;

  bot.on('end', (reason) => {
    reconnectAttempts++;
    const baseDelay = config.utils['auto-reconnect-delay'] || 5000;
    // Exponential backoff
    const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts - 1), 60000);

    console.log(`[INFO] Disconnected (reason: ${reason}). Reconnecting in ${delay / 1000}s...`);

    setTimeout(() => {
      if (reconnectAttempts <= maxReconnect) {
        createBot();
      } else {
        console.error('[FATAL] Max reconnect attempts reached. Giving up.');
      }
    }, delay);
  });

  bot.on('kicked', (reason) => {
    console.log(`[AfkBot] Kicked: ${reason}`);
  });

  bot.on('error', (err) => {
    console.error(`[ERROR] Bot error: ${err.message}`);
    // If it's a connection reset, you might want to proactively end the bot and reconnect:
    if (err.code === 'ECONNRESET') {
      console.log('[INFO] Connection reset, restarting bot...');
      bot.end(); // This will also trigger `end` event
    }
  });
}

// Starting the first bot
createBot();
