/**
 * API client for the openrm web frontend.
 * Exports one async function per API endpoint, returning typed responses.
 */

const API_BASE = '/api';

interface ApiErrorData {
  error?: string;
}

class ApiError extends Error {
  status: number;
  data: ApiErrorData;

  constructor(status: number, data: ApiErrorData) {
    super(data.error || `API error: ${status}`);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}

async function requestFormData<T>(
  method: string,
  path: string,
  formData: FormData
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}

// Auth
export async function login(password: string) {
  return request('POST', '/auth/login', { password });
}

export async function logout() {
  return request('POST', '/auth/logout');
}

// Status
export interface StatusResponse {
  ok: boolean;
  waStatus: string;
  uptimeSeconds: number;
  contactCount: number;
  messageCount: number;
  conversationCount: number;
  needsHumanCount: number;
  activeProvider: { name: string; model: string; embeddingModel: string | null } | null;
}

export async function getStatus(): Promise<StatusResponse> {
  return request('GET', '/status');
}

// Pairing
export interface PairingResponse {
  status: string;
  detail?: string;
  qr: string | null;
}

export async function getPairing(): Promise<PairingResponse> {
  return request('GET', '/pairing');
}

export async function reconnectPairing() {
  return request('POST', '/pairing/reconnect');
}

// Conversations
export interface ConversationSummary {
  id: string;
  contactId: string;
  phone: string;
  jid: string;
  name: string;
  needsHuman: boolean;
  humanControlled: boolean;
  lastText: string;
  lastAt: string;
}

export interface ConversationsResponse {
  conversations: ConversationSummary[];
}

export async function getConversations(): Promise<ConversationsResponse> {
  return request('GET', '/conversations');
}

export interface Message {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface ConversationThreadResponse {
  conversation: {
    id: string;
    needsHuman: boolean;
    humanControlled: boolean;
  };
  messages: Message[];
}

export async function getConversationMessages(conversationId: string): Promise<ConversationThreadResponse> {
  return request('GET', `/conversations/${conversationId}/messages`);
}

export async function sendReply(conversationId: string, text: string) {
  return request('POST', `/conversations/${conversationId}/reply`, { text });
}

export async function toggleHumanControl(conversationId: string) {
  return request('POST', `/conversations/${conversationId}/toggle-human`);
}

// Contacts
export interface ContactSummary {
  id: string;
  phone: string;
  name: string;
  updatedAt: string;
  interestCount: number;
}

export interface ContactsResponse {
  contacts: ContactSummary[];
}

export async function getContacts(): Promise<ContactsResponse> {
  return request('GET', '/contacts');
}

export interface Interest {
  label: string;
  notes: string;
}

export interface ContactDetailResponse {
  contact: {
    id: string;
    phone: string;
    name: string;
    jid: string;
    createdAt: string;
    updatedAt: string;
    interests: Interest[];
  };
  recentMessages: Message[];
}

export async function getContact(id: string): Promise<ContactDetailResponse> {
  return request('GET', `/contacts/${id}`);
}

export async function deleteContact(id: string) {
  return request('DELETE', `/contacts/${id}`);
}

// Providers
export interface ProviderConfig {
  id: string;
  name: string;
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  embeddingModel: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface ProvidersResponse {
  providers: ProviderConfig[];
}

export async function getProviders(): Promise<ProvidersResponse> {
  return request('GET', '/providers');
}

export async function createProvider(data: {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  embeddingModel?: string;
}) {
  return request('POST', '/providers', data);
}

export async function updateProvider(id: string, data: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  embeddingModel?: string;
}) {
  return request('PATCH', `/providers/${id}`, data);
}

export async function deleteProvider(id: string) {
  return request('DELETE', `/providers/${id}`);
}

export async function activateProvider(id: string) {
  return request('POST', `/providers/${id}/activate`);
}

export async function testProvider(id: string) {
  return request('POST', `/providers/${id}/test`);
}

export interface EmbeddingModel {
  name: string;
  size: number;
  source: string;
}

export interface EmbeddingModelsResponse {
  models: EmbeddingModel[];
}

export async function getEmbeddingModels(): Promise<EmbeddingModelsResponse> {
  return request('GET', '/providers/embedding-models');
}

export async function pullEmbeddingModel(providerId: string, model: string) {
  return request('POST', `/providers/${providerId}/pull-embedding-model`, { model });
}

// Soul
export interface SoulResponse {
  content: string;
}

export async function getSoul(): Promise<SoulResponse> {
  return request('GET', '/soul');
}

export async function updateSoul(content: string) {
  return request('PUT', '/soul', { content });
}

// System Prompt
export interface SystemPromptResponse {
  masterSystemPrompt: string;
  escalationPhone: string;
}

export async function getSystemPrompt(): Promise<SystemPromptResponse> {
  return request('GET', '/system-prompt');
}

export async function updateSystemPrompt(data: {
  masterSystemPrompt: string;
  escalationPhone: string;
}) {
  return request('PUT', '/system-prompt', data);
}

// RAG
export interface Document {
  id: string;
  title: string;
  sourcePath: string;
  chunkCount: number;
  createdAt: string;
}

export interface RagDocumentsResponse {
  documents: Document[];
}

export async function getRagDocuments(): Promise<RagDocumentsResponse> {
  return request('GET', '/rag/documents');
}

export async function uploadRagDocument(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return requestFormData('POST', '/rag/documents', formData);
}

export async function deleteRagDocument(id: string) {
  return request('DELETE', `/rag/documents/${id}`);
}

// MCP Servers
export interface McpServer {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string | null;
  args: string[];
  url: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface McpServersResponse {
  servers: McpServer[];
}

export async function getMcpServers(): Promise<McpServersResponse> {
  return request('GET', '/mcp');
}

export async function createMcpServer(data: {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
}) {
  return request('POST', '/mcp', data);
}

export async function updateMcpServer(id: string, data: {
  name?: string;
  command?: string;
  args?: string[];
  url?: string;
  enabled?: boolean;
}) {
  return request('PATCH', `/mcp/${id}`, data);
}

export async function deleteMcpServer(id: string) {
  return request('DELETE', `/mcp/${id}`);
}

export async function toggleMcpServer(id: string) {
  return request('POST', `/mcp/${id}/toggle`);
}

export async function testMcpServer(id: string) {
  return request('POST', `/mcp/${id}/test`);
}

export { ApiError };
