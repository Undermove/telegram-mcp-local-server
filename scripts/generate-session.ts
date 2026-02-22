import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import readline from "node:readline";

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function main(): Promise<void> {
  const apiIdRaw = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiIdRaw || !apiHash) {
    throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH must be set");
  }

  const apiId = Number(apiIdRaw);
  if (!Number.isFinite(apiId) || apiId <= 0) {
    throw new Error("TELEGRAM_API_ID must be a positive number");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const phoneNumber = await askQuestion(rl, "Phone number (with +): ");

    const stringSession = new StringSession("");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });

    await client.start({
      phoneNumber: async () => phoneNumber,
      phoneCode: async () => askQuestion(rl, "Code from Telegram: "),
      password: async () => askQuestion(rl, "2FA password (if enabled, else press Enter): "),
      onError: (err) => {
        console.error(err);
      },
    });

    console.error("Successfully authorized.");
    console.error("Copy TELEGRAM_SESSION_STRING below (keep it secret):");
    console.log(client.session.save());

    await client.disconnect();
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("Failed to generate session:", error);
  process.exit(1);
});
