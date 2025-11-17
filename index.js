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

  let pendingPromise = Promise.resolve();

  //
  // AUTH FUNCTIONS
  //
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
        }
      };

      bot.on('message', onMessage);

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
          reject(`[Login ERROR] Invalid password`);
        } else if (message.includes('not registered')) {
          bot.removeListener('message', onMessage);
          reject(`[Login ERROR] Not registered`);
        }
      };

      bot.on('message', onMessage);

      setTimeout(() => {
        bot.removeListener('message', onMessage);
        reject(`[Login ERROR] No login response after timeout`);
      }, 10000);
    });
  }

  //
  // SPAWN EVENT — FIXED HERE
  //
  bot.once('spawn', () => {
    console.log('[AfkBot] Bot joined the server');

    // FIX: this must happen AFTER spawn
    bot.settings.colorsEnabled = false;

    //
    // AUTO-AUTH
    //
    if (config.utils['auto-auth'].enabled) {
      console.log('[INFO] Auto-auth enabled');

      const password = config.utils['auto-auth'].password;

      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch(err => {
          console.error('[ERROR] Auth failed:', err);
          bot.end();
        });
    }

    //
    // GO TO POSITION
    //
    if (config.position.enabled) {
      const pos = config.position;
      console.log(`[AfkBot] Moving to ${pos.x}, ${pos.y}, ${pos.z}`);

      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    //
    // ANTI-AFK
    //
    if (config.utils['anti-afk'].enabled) {
      console.log('[INFO] Anti-AFK enabled');

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

  //
  // LOG EVENTS
  //
  bot.on('goal_reached', () => {
    console.log(`[AfkBot] Goal reached at ${bot.entity.position}`);
  });

  bot.on('death', () => {
    console.log(`[AfkBot] Died, respawned at ${bot.entity.position}`);
  });

  bot.on('kicked', (reason) => {
    console.log(`[AfkBot] Kicked: ${reason}`);
  });

  //
  // INFINITE RECONNECT (NO MAX ATTEMPTS)
  //
  let reconnectAttempts = 0;

  bot.on('end', (reason) => {
    reconnectAttempts++;

    const baseDelay = config.utils['auto-reconnect-delay'] || 5000;
    const delay = Math.min(baseDelay * (2 ** reconnectAttempts), 60000);

    console.log(`[INFO] Disconnected (${reason}). Reconnecting in ${delay / 1000}s...`);

    setTimeout(() => {
      createBot();
    }, delay);
  });

  bot.on('error', (err) => {
    console.error(`[ERROR] Bot error: ${err.message}`);

    if (err.code === 'ECONNRESET') {
      console.log('[INFO] ECONNRESET → reconnecting...');
      bot.end();
    }
  });
}

// Start the bot
createBot();
