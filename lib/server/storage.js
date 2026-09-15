import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_DATA } from './default-data.js';

const KEY = 'wedding-planner:data:v1';
const MAX_VERSIONS = 40;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw Object.assign(new Error('Invalid plan'), { statusCode: 400 });
  if (typeof plan.title !== 'string' || !plan.title.trim()) throw Object.assign(new Error('Plan title is required'), { statusCode: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.date || '')) throw Object.assign(new Error('Invalid plan date'), { statusCode: 400 });
  if (!/^\d{2}:\d{2}$/.test(plan.dayStart || '')) throw Object.assign(new Error('Invalid day start'), { statusCode: 400 });
  if (!Array.isArray(plan.activities) || plan.activities.length > 200) throw Object.assign(new Error('Invalid activities'), { statusCode: 400 });

  const ids = new Set();
  for (const activity of plan.activities) {
    if (!activity || typeof activity !== 'object') throw Object.assign(new Error('Invalid activity'), { statusCode: 400 });
    if (typeof activity.id !== 'string' || !activity.id || activity.id.length > 120 || ids.has(activity.id)) throw Object.assign(new Error('Invalid activity id'), { statusCode: 400 });
    ids.add(activity.id);
    if (typeof activity.title !== 'string' || !activity.title.trim() || activity.title.length > 100) throw Object.assign(new Error('Invalid activity title'), { statusCode: 400 });
    if (typeof activity.stage !== 'string' || !activity.stage || activity.stage.length > 40) throw Object.assign(new Error('Invalid activity stage'), { statusCode: 400 });
    if (!Number.isFinite(Number(activity.duration)) || Number(activity.duration) < 5 || Number(activity.duration) > 720) throw Object.assign(new Error('Invalid activity duration'), { statusCode: 400 });
    if (activity.lockedStart !== null && activity.lockedStart !== undefined && !/^\d{2}:\d{2}$/.test(activity.lockedStart)) throw Object.assign(new Error('Invalid fixed start time'), { statusCode: 400 });
    if (typeof activity.location !== 'string' || activity.location.length > 140) throw Object.assign(new Error('Invalid activity location'), { statusCode: 400 });
    if (typeof activity.notes !== 'string' || activity.notes.length > 1000) throw Object.assign(new Error('Invalid activity notes'), { statusCode: 400 });
    if (!Array.isArray(activity.people) || activity.people.length > 30 || activity.people.some(person => typeof person !== 'string' || person.length > 80)) throw Object.assign(new Error('Invalid activity people'), { statusCode: 400 });
  }
}

class UpstashDriver {
  constructor(url, token) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  async command(command) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command)
    });
    if (!response.ok) throw new Error(`Storage request failed (${response.status})`);
    const body = await response.json();
    if (body.error) throw new Error(body.error);
    return body.result;
  }

  async read() {
    const value = await this.command(['GET', KEY]);
    return value ? JSON.parse(value) : null;
  }

  async write(value) {
    await this.command(['SET', KEY, JSON.stringify(value)]);
  }
}

class FileDriver {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async read() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(value) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temp, this.filePath);
  }
}

function getDriver() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return new UpstashDriver(url, token);
  if (process.env.VERCEL) throw new Error('Cloud storage is not configured. Connect an Upstash Redis store to this project.');
  return new FileDriver(process.env.LOCAL_DATA_FILE || path.resolve('.data/store.json'));
}

export async function readData() {
  const driver = getDriver();
  const stored = await driver.read();
  if (stored) return stored;
  const seeded = clone(DEFAULT_DATA);
  seeded.updatedAt = new Date().toISOString();
  await driver.write(seeded);
  return seeded;
}

export async function savePlan(plan, expectedRevision) {
  validatePlan(plan);
  const driver = getDriver();
  const data = (await driver.read()) || clone(DEFAULT_DATA);
  if (Number(expectedRevision) !== Number(data.revision)) {
    const error = Object.assign(new Error('This plan was updated somewhere else. Reload before saving.'), { statusCode: 409, data });
    throw error;
  }
  data.plan = clone(plan);
  data.revision += 1;
  data.updatedAt = new Date().toISOString();
  await driver.write(data);
  return data;
}

export async function createVersion(name, expectedRevision) {
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cleanName) throw Object.assign(new Error('Version name is required'), { statusCode: 400 });
  const driver = getDriver();
  const data = (await driver.read()) || clone(DEFAULT_DATA);
  if (Number(expectedRevision) !== Number(data.revision)) throw Object.assign(new Error('Plan changed before the version could be saved'), { statusCode: 409, data });
  data.versions.unshift({
    id: crypto.randomUUID(),
    name: cleanName,
    createdAt: new Date().toISOString(),
    plan: clone(data.plan)
  });
  data.versions = data.versions.slice(0, MAX_VERSIONS);
  data.revision += 1;
  data.updatedAt = new Date().toISOString();
  await driver.write(data);
  return data;
}

export async function restoreVersion(id, expectedRevision) {
  const driver = getDriver();
  const data = (await driver.read()) || clone(DEFAULT_DATA);
  if (Number(expectedRevision) !== Number(data.revision)) throw Object.assign(new Error('Plan changed before the version could be restored'), { statusCode: 409, data });
  const version = data.versions.find(item => item.id === id);
  if (!version) throw Object.assign(new Error('Version not found'), { statusCode: 404 });
  data.plan = clone(version.plan);
  data.revision += 1;
  data.updatedAt = new Date().toISOString();
  await driver.write(data);
  return data;
}
