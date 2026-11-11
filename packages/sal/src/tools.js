import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, stat, access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, normalize } from 'node:path';
import { AppError, assert } from './errors.js';

const execAsync = promisify(exec);

export class ToolHarness {
  constructor({ audit, auth, permissions, logger = console } = {}) {
    this.audit = audit;
    this.auth = auth;
    this.permissions = permissions;
    this.logger = logger;
    this.tools = new Map();
    this.executionHistory = [];
    this.maxHistorySize = 1000;
    
    this.registerDefaultPrimitives();
  }

  registerDefaultPrimitives() {
    this.registerTool({
      name: 'create',
      description: 'Create a new resource (file, directory, record)',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['file', 'directory', 'record'], description: 'Resource type to create' },
          path: { type: 'string', description: 'Path or identifier for the resource' },
          content: { type: 'string', description: 'Content for file or record (optional)' },
          metadata: { type: 'object', description: 'Additional metadata (optional)' }
        },
        required: ['type', 'path']
      },
      handler: this.handleCreate.bind(this),
      permissions: ['tools:create'],
      reversible: true
    });

    this.registerTool({
      name: 'exec',
      description: 'Execute a command or operation',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command or operation to execute' },
          args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
          cwd: { type: 'string', description: 'Working directory (optional)' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' }
        },
        required: ['command']
      },
      handler: this.handleExec.bind(this),
      permissions: ['tools:exec'],
      reversible: false,
      dangerous: true
    });

    this.registerTool({
      name: 'read',
      description: 'Read a resource (file, record, state)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path or identifier to read' },
          format: { type: 'string', enum: ['text', 'json', 'binary'], description: 'Output format (default: text)' }
        },
        required: ['path']
      },
      handler: this.handleRead.bind(this),
      permissions: ['tools:read'],
      reversible: false
    });

    this.registerTool({
      name: 'help',
      description: 'List available tools or get help for a specific tool',
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'Tool name to get help for (optional)' }
        }
      },
      handler: this.handleHelp.bind(this),
      permissions: ['tools:help'],
      reversible: false
    });

    this.registerTool({
      name: 'curl',
      description: 'Execute HTTP requests with automatic retry and failure recovery',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'], description: 'HTTP method (default: GET)' },
          headers: { type: 'object', description: 'HTTP headers as key-value pairs' },
          data: { type: 'string', description: 'Request body data' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
          maxRetries: { type: 'number', description: 'Maximum retry attempts (default: 3)' },
          retryBackoffMs: { type: 'number', description: 'Initial backoff in milliseconds (default: 1000)' },
          outputFormat: { type: 'string', enum: ['json', 'text'], description: 'Parse response as JSON or text (default: json)' }
        },
        required: ['url']
      },
      handler: this.handleCurl.bind(this),
      permissions: ['tools:curl'],
      reversible: false,
      dangerous: true
    });
  }

  registerTool(tool) {
    assert(tool.name, 400, 'invalid_tool', 'Tool must have a name');
    assert(tool.handler, 400, 'invalid_tool', 'Tool must have a handler');
    assert(tool.permissions, 400, 'invalid_tool', 'Tool must have permissions');
    
    this.tools.set(tool.name, {
      id: randomUUID(),
      ...tool,
      registeredAt: new Date().toISOString()
    });
    
    this.logger.log(`[ToolHarness] Registered tool: ${tool.name}`);
  }

  listTools() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      dangerous: tool.dangerous ?? false,
      reversible: tool.reversible ?? false,
      requiredPermissions: tool.permissions
    }));
  }

  getTool(name) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new AppError(404, 'tool_not_found', `Tool '${name}' not found`);
    }
    return tool;
  }

  async execute({ toolName, parameters, actor, requestId }) {
    const tool = this.getTool(toolName);
    
    // Validate parameters
    this.validateParameters(tool, parameters);
    
    // Check permissions using PermissionService if available, otherwise fallback to AuthService
    if (actor?.session) {
      if (this.permissions) {
        const permissionResult = await this.permissions.checkToolPermission({
          session: actor.session,
          toolName,
          toolPermissions: tool.permissions,
          resourceContext: parameters.resourceContext ?? {}
        });
        
        if (!permissionResult.allowed) {
          throw new AppError(403, 'permission_denied', permissionResult.reason);
        }
      } else {
        this.auth.checkPermissions(actor.session, tool.permissions);
      }
    }
    
    const executionId = randomUUID();
    const startedAt = new Date().toISOString();
    const started = performance.now();
    
    // Log execution start
    this.logger.log(`[ToolHarness] Executing ${toolName}: ${JSON.stringify(parameters)}`);
    
    try {
      // Execute the tool
      const result = await tool.handler(parameters, { actor, requestId, tool });
      
      const completedAt = new Date().toISOString();
      const latencyMs = Math.round(performance.now() - started);
      
      const execution = {
        id: executionId,
        requestId,
        toolName,
        parameters,
        result,
        actor: actor ? { bbid: actor.bbid, userId: actor.userId } : null,
        startedAt,
        completedAt,
        latencyMs,
        status: 'success'
      };
      
      // Add to history
      this.addToHistory(execution);
      
      // Audit log
      if (this.audit) {
        await this.audit.append({
          type: 'tool.executed',
          actor: actor ?? {},
          summary: `Executed tool ${toolName}`,
          metadata: {
            executionId,
            toolName,
            parameters,
            latencyMs,
            result: this.sanitizeResult(result)
          }
        });
      }
      
      return execution;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const latencyMs = Math.round(performance.now() - started);
      
      const execution = {
        id: executionId,
        requestId,
        toolName,
        parameters,
        result: null,
        error: error.message,
        actor: actor ? { bbid: actor.bbid, userId: actor.userId } : null,
        startedAt,
        completedAt,
        latencyMs,
        status: 'error'
      };
      
      this.addToHistory(execution);
      
      if (this.audit) {
        await this.audit.append({
          type: 'tool.failed',
          actor: actor ?? {},
          summary: `Tool ${toolName} failed: ${error.message}`,
          metadata: {
            executionId,
            toolName,
            parameters,
            error: error.message
          }
        });
      }
      
      throw error;
    }
  }

  validateParameters(tool, parameters) {
    if (!tool.parameters) return;
    
    const schema = tool.parameters;
    const params = parameters ?? {};
    
    if (schema.required) {
      for (const required of schema.required) {
        if (!(required in params)) {
          throw new AppError(400, 'missing_parameter', `Missing required parameter: ${required}`);
        }
      }
    }
    
    // Type validation for known properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in params) {
          const value = params[key];
          if (propSchema.type === 'string' && typeof value !== 'string') {
            throw new AppError(400, 'invalid_parameter', `Parameter ${key} must be a string`);
          }
          if (propSchema.type === 'number' && typeof value !== 'number') {
            throw new AppError(400, 'invalid_parameter', `Parameter ${key} must be a number`);
          }
          if (propSchema.type === 'array' && !Array.isArray(value)) {
            throw new AppError(400, 'invalid_parameter', `Parameter ${key} must be an array`);
          }
          if (propSchema.enum && !propSchema.enum.includes(value)) {
            throw new AppError(400, 'invalid_parameter', `Parameter ${key} must be one of: ${propSchema.enum.join(', ')}`);
          }
        }
      }
    }
  }

  addToHistory(execution) {
    this.executionHistory.push(execution);
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }
  }

  getHistory({ limit = 50, toolName, actor } = {}) {
    let filtered = this.executionHistory;
    
    if (toolName) {
      filtered = filtered.filter(e => e.toolName === toolName);
    }
    
    if (actor?.bbid) {
      filtered = filtered.filter(e => e.actor?.bbid === actor.bbid);
    }
    
    return filtered.slice(-limit);
  }

  sanitizeResult(result) {
    // Remove sensitive data from audit logs
    if (typeof result !== 'object' || result === null) {
      return result;
    }
    
    const sanitized = { ...result };
    const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'privateKey'];
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  // Default tool handlers

  async handleCreate(parameters, context) {
    const { type, path, content, metadata } = parameters;
    
    // Resolve and normalize the path
    const cwd = process.cwd();
    const resolvedPath = path.startsWith('/') ? resolve(path) : join(cwd, path);
    const normalizedPath = normalize(resolvedPath);
    
    this.logger.log(`[ToolHarness] Creating ${type} at ${normalizedPath} (cwd: ${cwd}, original: ${path})`);
    
    // Security: prevent path traversal outside working directory
    if (!normalizedPath.startsWith(cwd)) {
      throw new AppError(403, 'path_forbidden', 'Cannot create resources outside working directory');
    }
    
    if (type === 'file') {
      await writeFile(normalizedPath, content ?? '', 'utf8');
      const stats = await stat(normalizedPath);
      this.logger.log(`[ToolHarness] File created: ${normalizedPath}, size: ${stats.size}`);
      return {
        success: true,
        type: 'file',
        path: normalizedPath,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
        message: `File created at ${normalizedPath}`
      };
    }
    
    if (type === 'directory') {
      await mkdir(normalizedPath, { recursive: true });
      const stats = await stat(normalizedPath);
      return {
        success: true,
        type: 'directory',
        path: normalizedPath,
        createdAt: stats.mtime.toISOString(),
        message: `Directory created at ${normalizedPath}`
      };
    }
    
    if (type === 'record') {
      // For records, we'll store them in a data directory
      const dataDir = join(cwd, 'data', 'records');
      if (!existsSync(dataDir)) {
        await mkdir(dataDir, { recursive: true });
      }
      const recordPath = join(dataDir, `${path}.json`);
      const record = {
        id: path,
        metadata: metadata ?? {},
        createdAt: new Date().toISOString()
      };
      await writeFile(recordPath, JSON.stringify(record, null, 2), 'utf8');
      return {
        success: true,
        type: 'record',
        id: path,
        path: recordPath,
        metadata: metadata ?? {},
        createdAt: record.createdAt,
        message: `Record created with id: ${path}`
      };
    }
    
    throw new AppError(400, 'invalid_type', `Unknown resource type: ${type}`);
  }

  async handleExec(parameters, context) {
    const { command, args = [], cwd: workingDir, timeout = 30000 } = parameters;
    
    // Safety check: block dangerous commands
    const dangerousCommands = ['rm', 'dd', 'mkfs', 'format', 'del', 'erase', 'fdisk', 'shutdown', 'reboot'];
    const commandBase = command.split(' ')[0].trim();
    
    if (dangerousCommands.includes(commandBase)) {
      throw new AppError(403, 'dangerous_command', `Command '${command}' is not allowed`);
    }
    
    // Resolve working directory
    const resolvedCwd = workingDir ? resolve(workingDir) : process.cwd();
    
    // Security: prevent working directory outside project root
    const projectRoot = process.cwd();
    if (!resolvedCwd.startsWith(projectRoot)) {
      throw new AppError(403, 'path_forbidden', 'Cannot execute commands outside project directory');
    }
    
    try {
      const { stdout, stderr } = await execAsync(
        `${command} ${args.join(' ')}`,
        {
          cwd: resolvedCwd,
          timeout,
          maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        }
      );
      
      return {
        success: true,
        command,
        args,
        exitCode: 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        executedAt: new Date().toISOString()
      };
    } catch (error) {
      // Command failed but still return result
      return {
        success: false,
        command,
        args,
        exitCode: error.code || 1,
        stdout: error.stdout?.trim() || '',
        stderr: error.stderr?.trim() || error.message,
        executedAt: new Date().toISOString()
      };
    }
  }

  async handleRead(parameters, context) {
    const { path, format = 'text' } = parameters;
    
    // Resolve and normalize the path
    const cwd = process.cwd();
    const resolvedPath = path.startsWith('/') ? resolve(path) : join(cwd, path);
    const normalizedPath = normalize(resolvedPath);
    
    this.logger.log(`[ToolHarness] Reading ${format} file at ${normalizedPath} (cwd: ${cwd}, original: ${path})`);
    
    // Security: prevent reading files outside working directory
    if (!normalizedPath.startsWith(cwd)) {
      throw new AppError(403, 'path_forbidden', 'Cannot read files outside working directory');
    }
    
    // Check if file exists
    try {
      await access(normalizedPath, constants.R_OK);
    } catch {
      throw new AppError(404, 'file_not_found', `File not found: ${path}`);
    }
    
    // Read file based on format
    const stats = await stat(normalizedPath);
    
    if (format === 'binary') {
      const buffer = await readFile(normalizedPath);
      return {
        success: true,
        path: normalizedPath,
        format: 'binary',
        content: buffer.toString('base64'),
        size: stats.size,
        readAt: new Date().toISOString()
      };
    }
    
    if (format === 'json') {
      const content = await readFile(normalizedPath, 'utf8');
      try {
        const json = JSON.parse(content);
        return {
          success: true,
          path: normalizedPath,
          format: 'json',
          content: json,
          size: stats.size,
          readAt: new Date().toISOString()
        };
      } catch {
        throw new AppError(400, 'invalid_json', 'File is not valid JSON');
      }
    }
    
    // Default: text format
    const content = await readFile(normalizedPath, 'utf8');
    return {
      success: true,
      path: normalizedPath,
      format: 'text',
      content,
      size: stats.size,
      readAt: new Date().toISOString()
    };
  }

  async handleHelp(parameters, context) {
    const { tool } = parameters;
    
    if (tool) {
      const toolDef = this.getTool(tool);
      return {
        name: toolDef.name,
        description: toolDef.description,
        parameters: toolDef.parameters,
        permissions: toolDef.permissions,
        reversible: toolDef.reversible ?? false,
        dangerous: toolDef.dangerous ?? false
      };
    }
    
    return {
      availableTools: this.listTools(),
      usage: 'Use executeTool with toolName and parameters'
    };
  }

  async handleCurl(parameters, context) {
    const {
      url,
      method = 'GET',
      headers = {},
      data,
      timeout = 30000,
      maxRetries = 3,
      retryBackoffMs = 1000,
      outputFormat = 'json'
    } = parameters;

    // Validate URL
    try {
      new URL(url);
    } catch {
      throw new AppError(400, 'invalid_url', `Invalid URL: ${url}`);
    }

    // Security: block internal/private IPs
    const hostname = new URL(url).hostname;
    const privatePatterns = [
      /^localhost$/, /^127\./, /^0\./,
      /^10\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./,
      /^::1$/, /^fc00:/, /^fe80:/
    ];
    if (privatePatterns.some(pattern => pattern.test(hostname))) {
      throw new AppError(403, 'forbidden_url', `Cannot access private/internal URL: ${url}`);
    }

    const attemptHistory = [];
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const attemptStart = performance.now();
      
      try {
        // Build curl command with proper escaping
        let curlCmd = 'curl -s -w "\\n%{http_code}"';
        curlCmd += ` -X ${method}`;
        curlCmd += ` --max-time ${Math.ceil(timeout / 1000)}`;

        // Add headers
        for (const [key, value] of Object.entries(headers)) {
          curlCmd += ` -H "${key}: ${value}"`;
        }

        // Add data for POST/PUT/PATCH
        if (data && ['POST', 'PUT', 'PATCH'].includes(method)) {
          curlCmd += ` -d '${data.replace(/'/g, "'\\''")}'`;
        }

        curlCmd += ` "${url}"`;

        this.logger.log(`[ToolHarness] Curl attempt ${attempt + 1}/${maxRetries + 1}: ${method} ${url}`);

        const { stdout, stderr } = await execAsync(curlCmd, {
          timeout,
          maxBuffer: 1024 * 1024 * 10,
          shell: '/bin/sh'
        });

        // Parse output (last line is status code)
        const lines = stdout.trim().split('\n');
        const statusCode = parseInt(lines.pop());
        const body = lines.join('\n');

        const attemptResult = {
          attempt: attempt + 1,
          statusCode,
          body,
          durationMs: Math.round(performance.now() - attemptStart),
          timestamp: new Date().toISOString()
        };
        attemptHistory.push(attemptResult);

        // Check if successful (2xx status)
        if (statusCode >= 200 && statusCode < 300) {
          let parsedBody;
          try {
            parsedBody = outputFormat === 'json' ? JSON.parse(body) : body;
          } catch {
            parsedBody = body; // Return as text if JSON parsing fails
          }

          return {
            success: true,
            url,
            method,
            statusCode,
            body: parsedBody,
            headers: headers,
            attemptCount: attempt + 1,
            attemptHistory,
            durationMs: attemptHistory.reduce((sum, a) => sum + a.durationMs, 0),
            completedAt: new Date().toISOString()
          };
        }

        // Non-2xx status - check if retryable
        const retryable = this.isRetryableStatus(statusCode);
        if (retryable && attempt < maxRetries) {
          const backoff = retryBackoffMs * Math.pow(2, attempt);
          this.logger.log(`[ToolHarness] Curl failed with ${statusCode}, retrying in ${backoff}ms`);
          await this.sleep(backoff);
          lastError = { type: 'http_error', statusCode, body };
          continue;
        }

        // Non-retryable or max retries exceeded
        const recovery = this.suggestRecovery(statusCode, body, stderr);
        return {
          success: false,
          url,
          method,
          statusCode,
          body,
          error: `HTTP ${statusCode}: ${this.getStatusText(statusCode)}`,
          attemptCount: attempt + 1,
          attemptHistory,
          durationMs: attemptHistory.reduce((sum, a) => sum + a.durationMs, 0),
          recovery,
          completedAt: new Date().toISOString()
        };

      } catch (error) {
        const attemptResult = {
          attempt: attempt + 1,
          error: error.message,
          durationMs: Math.round(performance.now() - attemptStart),
          timestamp: new Date().toISOString()
        };
        attemptHistory.push(attemptResult);

        // Network errors are retryable
        if (attempt < maxRetries && this.isRetryableError(error)) {
          const backoff = retryBackoffMs * Math.pow(2, attempt);
          this.logger.log(`[ToolHarness] Curl network error: ${error.message}, retrying in ${backoff}ms`);
          await this.sleep(backoff);
          lastError = { type: 'network_error', message: error.message };
          continue;
        }

        // Max retries exceeded or non-retryable error
        const recovery = this.suggestRecovery(null, null, error.message);
        return {
          success: false,
          url,
          method,
          error: error.message,
          attemptCount: attempt + 1,
          attemptHistory,
          durationMs: attemptHistory.reduce((sum, a) => sum + a.durationMs, 0),
          recovery,
          completedAt: new Date().toISOString()
        };
      }
    }
  }

  isRetryableStatus(statusCode) {
    // Retry on: 408 (Request Timeout), 429 (Too Many Requests), 500, 502, 503, 504
    return [408, 429, 500, 502, 503, 504].includes(statusCode);
  }

  isRetryableError(error) {
    // Retry on timeout, ECONNRESET, ETIMEDOUT, ENOTFOUND (sometimes)
    const retryablePatterns = ['ETIMEDOUT', 'ECONNRESET', 'ESOCKETTIMEDOUT', 'timeout'];
    return retryablePatterns.some(pattern => error.message.includes(pattern));
  }

  suggestRecovery(statusCode, body, errorMessage) {
    const suggestions = [];

    if (statusCode === 401) {
      suggestions.push('Check authentication credentials (API key, token)');
      suggestions.push('Verify Authorization header format');
    } else if (statusCode === 403) {
      suggestions.push('Check if you have permission to access this resource');
      suggestions.push('Verify API key has required scopes');
    } else if (statusCode === 404) {
      suggestions.push('Verify the URL is correct');
      suggestions.push('Check if the resource exists or has been moved');
    } else if (statusCode === 429) {
      suggestions.push('Rate limit exceeded - implement exponential backoff');
      suggestions.push('Check API quota and usage limits');
    } else if (statusCode >= 500) {
      suggestions.push('Server error - retry with longer backoff');
      suggestions.push('Check service status page for outages');
    } else if (errorMessage) {
      if (errorMessage.includes('ENOTFOUND')) {
        suggestions.push('DNS resolution failed - check hostname spelling');
        suggestions.push('Verify network connectivity');
      } else if (errorMessage.includes('ECONNREFUSED')) {
        suggestions.push('Connection refused - check if server is running');
        suggestions.push('Verify port and firewall settings');
      } else if (errorMessage.includes('timeout')) {
        suggestions.push('Request timed out - increase timeout parameter');
        suggestions.push('Check network latency');
      }
    }

    if (suggestions.length === 0) {
      suggestions.push('Review error details and try alternative approach');
      suggestions.push('Check API documentation for this endpoint');
    }

    return suggestions;
  }

  getStatusText(statusCode) {
    const statusTexts = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      408: 'Request Timeout',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout'
    };
    return statusTexts[statusCode] || 'Unknown Status';
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
