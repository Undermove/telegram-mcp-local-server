import { TelegramClient as TgClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram";
import { LogLevel } from "telegram/extensions/Logger.js";

export interface TelegramConfig {
  apiId: number;
  apiHash: string;
  sessionString?: string;
}

export interface ChatInfo {
  id: string;
  title: string;
  type: string;
  username?: string;
  participantsCount?: number;
}

export interface MessageInfo {
  id: number;
  text: string;
  date: Date;
  fromId?: string;
  fromUsername?: string;
  fromFirstName?: string;
  fromLastName?: string;
  replyToMsgId?: number;
}

export interface FolderInfo {
  id: number;
  title: string;
  emoticon?: string;
}

export class TelegramClient {
  private client: TgClient;
  private config: TelegramConfig;

  constructor(config: TelegramConfig) {
    this.config = config;
    const session = new StringSession(config.sessionString || "");
    
    this.client = new TgClient(session, config.apiId, config.apiHash, {
      connectionRetries: 2,
    });
    this.client.setLogLevel(LogLevel.NONE);
  }

  async connect(): Promise<void> {
    //console.error("Connecting to Telegram...");
    await this.client.connect();
    //console.error("Connected to Telegram successfully");
  }

  async getChats(limit: number = 50): Promise<ChatInfo[]> {
    //console.error(`Fetching ${limit} chats...`);
    
    const dialogs = await this.client.getDialogs({ limit });
    
    const chats: ChatInfo[] = [];
    
    for (const dialog of dialogs) {
      const entity = dialog.entity as any;
      
      if (!entity) continue;
      
      let chatInfo: ChatInfo;
      
      if (entity.className === "User") {
        chatInfo = {
          id: entity.id.toString(),
          title: `${entity.firstName || ""} ${entity.lastName || ""}`.trim(),
          type: "user",
          username: entity.username,
        };
      } else if (entity.className === "Chat") {
        chatInfo = {
          id: entity.id.toString(),
          title: entity.title,
          type: "group",
          participantsCount: entity.participantsCount,
        };
      } else if (entity.className === "Channel") {
        chatInfo = {
          id: entity.id.toString(),
          title: entity.title,
          type: entity.broadcast ? "channel" : "supergroup",
          username: entity.username,
          participantsCount: entity.participantsCount,
        };
      } else {
        continue; // Skip unknown entity types
      }
      
      chats.push(chatInfo);
    }
    
    //console.error(`Fetched ${chats.length} chats`);
    return chats;
  }

  async getChatHistory(chatId: string, limit: number = 50, offsetId?: number): Promise<MessageInfo[]> {
    //console.error(`Fetching ${limit} messages from chat ${chatId}...`);
    
    try {
      const entity = await this.client.getEntity(chatId);
      
      const messages = await this.client.getMessages(entity, {
        limit,
        offsetId,
      });
      
      const messageInfos: MessageInfo[] = [];
      
      for (const message of messages) {
        const msg = message as any;
        if (!msg || msg.className !== "Message") {
          continue;
        }
        
        let fromUsername: string | undefined;
        let fromFirstName: string | undefined;
        let fromLastName: string | undefined;
        
        if (msg.fromId) {
          try {
            const sender = await this.client.getEntity(msg.fromId) as any;
            if (sender?.className === "User") {
              fromUsername = sender.username;
              fromFirstName = sender.firstName;
              fromLastName = sender.lastName;
            }
          } catch (error) {
            // console.error("Error getting sender info:", error);
          }
        }
        
        const messageInfo: MessageInfo = {
          id: msg.id,
          text: msg.message || "",
          date: new Date(msg.date * 1000),
          fromId: msg.fromId?.toString(),
          fromUsername,
          fromFirstName,
          fromLastName,
          replyToMsgId: msg.replyTo?.replyToMsgId,
        };
        
        messageInfos.push(messageInfo);
      }
      
      // console.error(`Fetched ${messageInfos.length} messages`);
      return messageInfos;
    } catch (error) {
      // console.error(`Error fetching chat history for ${chatId}:`, error);
      throw error;
    }
  }

  private parseMarkdown(text: string): [string, Api.TypeMessageEntity[]] {
    const entities: Api.TypeMessageEntity[] = [];
    let cleanText = "";
    let i = 0;

    while (i < text.length) {
      if (text.startsWith("```", i)) {
        i += 3;
        let lang = "";
        const nlPos = text.indexOf("\n", i);
        if (nlPos !== -1) {
          const possibleLang = text.slice(i, nlPos).trim();
          if (possibleLang && !possibleLang.includes(" ") && !possibleLang.includes("`")) {
            lang = possibleLang;
            i = nlPos + 1;
          }
        }
        const endPos = text.indexOf("```", i);
        if (endPos === -1) {
          cleanText += "```" + text.slice(i);
          i = text.length;
        } else {
          const code = text.slice(i, endPos);
          const offset = [...cleanText].length;
          cleanText += code;
          entities.push(new Api.MessageEntityPre({ offset, length: [...code].length, language: lang }));
          i = endPos + 3;
          if (i < text.length && text[i] === "\n") i++;
        }
      } else if (text[i] === "`") {
        i++;
        const endPos = text.indexOf("`", i);
        if (endPos === -1) {
          cleanText += "`";
        } else {
          const code = text.slice(i, endPos);
          const offset = [...cleanText].length;
          cleanText += code;
          entities.push(new Api.MessageEntityCode({ offset, length: [...code].length }));
          i = endPos + 1;
        }
      } else {
        cleanText += text[i];
        i++;
      }
    }

    return [cleanText, entities];
  }

  async sendMessage(chatId: string, message: string): Promise<MessageInfo> {
    // console.error(`Sending message to chat ${chatId}...`);
    
    try {
      const entity = await this.client.getEntity(chatId);
      const [parsedMessage, formattingEntities] = this.parseMarkdown(message);
      const result = await this.client.sendMessage(entity, { message: parsedMessage, formattingEntities }) as any;
      
      if (!result || result.className !== "Message") {
        throw new Error("Failed to send message");
      }
      
      const messageInfo: MessageInfo = {
        id: result.id,
        text: result.message || "",
        date: new Date(result.date * 1000),
        fromId: result.fromId?.toString(),
      };
      
      // console.error("Message sent successfully");
      return messageInfo;
    } catch (error) {
      // console.error(`Error sending message to ${chatId}:`, error);
      throw error;
    }
  }

  async getFolders(): Promise<FolderInfo[]> {
    // console.error("Fetching dialog folders...");
    try {
      const filters = await (this.client as any).invoke(new Api.messages.GetDialogFilters());
      const folders: FolderInfo[] = [];

      for (const f of filters as any[]) {
        if (f && (f instanceof Api.DialogFilter)) {
          const titleVal = typeof (f as any).title === 'string'
            ? (f as any).title
            : ((f as any).title?.text ?? '');
          folders.push({ id: Number(f.id), title: String(titleVal), emoticon: (f as any).emoticon });
        }
        // Skip DialogFilterDefault and other types
      }

      // console.error(`Fetched ${folders.length} folders`);
      return folders;
    } catch (error) {
      // console.error("Error fetching dialog folders:", error);
      throw error;
    }
  }

  async getChannelsFromFolder(folderId: number, limit: number = 50): Promise<ChatInfo[]> {
    // console.error(`Fetching up to ${limit} channels from folder ${folderId}...`);
    try {
      const filters = await (this.client as any).invoke(new Api.messages.GetDialogFilters());
      let targetFilter: any | undefined;

      for (const f of filters as any[]) {
        if (f && (f instanceof Api.DialogFilter) && Number((f as any).id) === Number(folderId)) {
          targetFilter = f;
          break;
        }
      }

      if (!targetFilter) {
        throw new Error(`Folder with id ${folderId} not found`);
      }

      const toPeerKey = (p: any): string | null => {
        if (!p) return null;
        // Handle InputPeer and Peer variants by checking known id fields
        if (typeof (p as any).channelId !== 'undefined') return `channel:${(p as any).channelId.toString()}`;
        if (typeof (p as any).chatId !== 'undefined') return `chat:${(p as any).chatId.toString()}`;
        if (typeof (p as any).userId !== 'undefined') return `user:${(p as any).userId.toString()}`;
        return null;
      };

      const included = new Set<string>();
      const excluded = new Set<string>();

      const includePeers: any[] = (targetFilter.includePeers || []) as any[];
      const excludePeers: any[] = (targetFilter.excludePeers || []) as any[];
      const pinnedPeers: any[] = (targetFilter.pinnedPeers || []) as any[];

      for (const p of [...includePeers, ...pinnedPeers]) {
        const k = toPeerKey(p);
        if (k) included.add(k);
      }
      for (const p of excludePeers) {
        const k = toPeerKey(p);
        if (k) excluded.add(k);
      }

      // Get a reasonably large set of dialogs to filter from
      const dialogs = await this.client.getDialogs({ limit: Math.max(limit * 4, 200) });
      const channels: ChatInfo[] = [];

      for (const dialog of dialogs) {
        const entity = (dialog as any).entity as any;
        if (!entity) continue;

        const entityKey = entity.className === 'Channel'
          ? `channel:${entity.id.toString()}`
          : entity.className === 'Chat'
            ? `chat:${entity.id.toString()}`
            : entity.className === 'User'
              ? `user:${entity.id.toString()}`
              : null;
        if (!entityKey) continue;

        // Determine inclusion according to filter
        let inFilter = true;
        if (included.size > 0) {
          inFilter = included.has(entityKey);
        } else {
          if (excluded.has(entityKey)) inFilter = false;
          // Note: For simplicity, we don't evaluate category flags (contacts, groups, channels, etc.) here.
        }
        if (!inFilter) continue;

        // Only return channels/supergroups
        if (entity.className === 'Channel') {
          channels.push({
            id: entity.id.toString(),
            title: entity.title,
            type: entity.broadcast ? 'channel' : 'supergroup',
            username: entity.username,
            participantsCount: entity.participantsCount,
          });
        }

        if (channels.length >= limit) break;
      }

      // console.error(`Fetched ${channels.length} channels from folder ${folderId}`);
      return channels;
    } catch (error) {
      // console.error(`Error fetching channels from folder ${folderId}:`, error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // console.error("Disconnecting from Telegram...");
    await this.client.disconnect();
    // console.error("Disconnected from Telegram");
  }
}