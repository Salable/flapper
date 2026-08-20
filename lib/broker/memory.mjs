/**
 * In-memory broker: Maps standing in for Redis.
 *
 * This is what `next dev` and the tests run against, so the board works with
 * zero environment. Single-process only. Board identity lives in Postgres now;
 * the broker only carries the realtime channel - the command stream a display
 * consumes and the state snapshot it posts back - keyed by internal board id,
 * created on first touch.
 */

const MAX_COMMANDS = 1000;

export class MemoryBroker {
  constructor() {
    this.channels = new Map();
  }

  channel(boardId) {
    let entry = this.channels.get(boardId);
    if (!entry) {
      entry = { commands: [], nextSeq: 1, state: null };
      this.channels.set(boardId, entry);
    }
    return entry;
  }

  async touch() {
    // TTLs are a Redis concern; memory channels live as long as the process.
  }

  async appendCommand(boardId, cmd) {
    const channel = this.channel(boardId);
    const id = String(channel.nextSeq++);
    channel.commands.push({ id, cmd });
    if (channel.commands.length > MAX_COMMANDS) {
      channel.commands.splice(0, channel.commands.length - MAX_COMMANDS);
    }
    return id;
  }

  async commandsAfter(boardId, afterId, limit = 100) {
    const after = Number(afterId) || 0;
    return this.channel(boardId)
      .commands.filter((entry) => Number(entry.id) > after)
      .slice(0, limit);
  }

  async latestCommandId(boardId) {
    const { commands } = this.channel(boardId);
    return commands[commands.length - 1]?.id ?? '0';
  }

  async setState(boardId, snapshot) {
    this.channel(boardId).state = { snapshot, updatedAt: Date.now() };
  }

  async getState(boardId) {
    return this.channel(boardId).state;
  }

  async deleteBoard(boardId) {
    this.channels.delete(boardId);
  }
}
