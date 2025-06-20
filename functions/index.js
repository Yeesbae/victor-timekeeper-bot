const functions = require("firebase-functions");
const {Bot, webhookCallback} = require("grammy");
const admin = require("firebase-admin");
const {FirebaseFunctionsRateLimiter} =
  require("firebase-functions-rate-limiter");


admin.initializeApp({
  databaseURL: "https://victortimekeeperbot-default-rtdb.asia-southeast1.firebasedatabase.app/",
});

const database = admin.database();

const limiter = FirebaseFunctionsRateLimiter.withRealtimeDbBackend(
    {
      name: "telegram_rate_limiter",
      maxCalls: 50, // Adjust based on your needs
      periodSeconds: 86400, // 24 hours
    },
    database,
);

const bot = new Bot("7341843537:AAEaf8Hfkh5ysUOC5c7NqcoQZWeCh-B5dC0");


/**
 * Checks if the command is from the allowed chat group.
 * @param {Context} ctx - The Telegram context object.
 * @return {boolean} True if chat is authorized.
 */
function isAuthorizedChat(ctx) {
  return ctx.chat && ctx.chat.id === ALLOWED_CHAT_ID;
}

// Replace with your actual group chat ID
const ALLOWED_CHAT_ID = -1002206768237;

bot.command("getchatid", (ctx) => {
  ctx.reply(`This chat's ID is: ${ctx.chat.id}`);
});

bot.command("start", (ctx) => {
  if (!isAuthorizedChat(ctx)) {
    return;
  }
  ctx.reply("Welcome Victor! Bot is up and running.");
});


bot.command("set", async (ctx) => {
  if (!isAuthorizedChat(ctx)) {
    return;
  }
  // Example: /set 2025-12-31 23:59:59 New Year Description of event
  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3) {
    return ctx.reply("Usage: /set YYYY-MM-DD HH:MM:SS EventName [Description]");
  }

  const dateStr = input[0] + " " + input[1];
  const eventName = input[2];
  const description = input.slice(3).join(" ") || ""; // Optional description
  const targetDate = new Date(dateStr);

  if (isNaN(targetDate)) {
    return ctx.reply("Invalid date format.");
  }

  const now = new Date();
  const msUntil = targetDate - now;

  if (msUntil <= 0) {
    return ctx.reply("Please enter a future date and time.");
  }

  // Store the countdown info in the database under the chat group
  const eventRef = database.ref(`countdowns/${ctx.chat.id}`).push();
  await eventRef.set({
    date: dateStr,
    event: eventName,
    description: description,
    createdBy: ctx.from.username || ctx.from.first_name,
    createdAt: now.toISOString(),
  });

  ctx.reply(
      `Countdown set for "${eventName}" on ${dateStr}!\n` +
        `Description: ${description}`,
  );
});

bot.command("list", async (ctx) => {
  if (!isAuthorizedChat(ctx)) {
    return;
  }

  const args = ctx.message.text.split(" ").slice(1);
  const filterTerm = args.length > 0 ? args.join(" ").toLowerCase() : null;
  const ref = database.ref(`countdowns/${ctx.chat.id}`);
  const snapshot = await ref.once("value");
  const data = snapshot.val();

  if (!data) {
    return ctx.reply("No countdowns set yet.");
  }

  let filteredData = Object.values(data);

  if (filterTerm) {
    filteredData = filteredData.filter((item) =>
      item.event.toLowerCase().includes(filterTerm),
    );
    if (filteredData.length === 0) {
      return ctx.reply(`No countdowns found matching "${filterTerm}".`);
    }
  }

  let message = "Countdowns:\n";
  Object.values(data).forEach((item, idx) => {
    message +=
      `\n${idx + 1}. "${item.event}" on ${item.date}\n` +
      `Description: ${item.description}\n` +
      `Set by: ${item.createdBy}\n`;
  });
  ctx.reply(message);
});

(async () => {
  await bot.api.setMyCommands([
    {command: "start", description: "Start bot"},
    {command: "getchatid", description: "Get current chat ID"},
    {command: "set", description: "Set countdown event"},
    {
      command: "list",
      description: "List all or filter countdowns by name: 'list <name>'",
    },
  ]);
  bot.start();
})();

exports.telegramWebhook = functions.https.onRequest(async (req, res) => {
  let userId = "unknown";
  try {
    // Apply rate limiting using Telegram user ID
    userId =
      req.body &&
      req.body.message &&
      req.body.message.from &&
      req.body.message.from.id ?
        req.body.message.from.id :
        "unknown";
    await limiter.rejectOnQuotaExceededOrRecordUsage(userId);

    return webhookCallback(bot)(req, res);
  } catch (error) {
    if (error.message && error.message.includes("Quota exceeded")) {
      console.log(`Rate limit exceeded for user ${userId}`);

      const chatId = req.body.message?.chat?.id;
      const messageId = req.body.message?.message_id;

      if (chatId) {
        await bot.api.sendMessage(
            chatId,
            "🚫 You have reached the daily usage limit. Please try again later.",
            {reply_to_message_id: messageId},
        );
      }

      return res.status(429).send("Too many requests. Please try again later.");
    }
    console.error("Error:", error);
    return res.status(500).send("Internal server error");
  }
});

//
