/**
 * AWS SQS Queue implementation
 * Provides standard and FIFO queues with AWS-specific features
 */
import { BaseService } from '../baseService.js';

export class AWSQueue extends BaseService {
  constructor(config = {}) {
    super(
      config.name || 'AWS-SQS',
      'aws',
      config.capacity || 3000, // messages per second
      config.baseCost || 0.0004 // $0.0004 per 1M requests
    );
    
    // AWS SQS specific configuration
    this.type = 'queue';
    this.queueType = config.queueType || 'standard'; // standard or fifo
    this.queueUrl = config.queueUrl || `https://sqs.us-east-1.amazonaws.com/123456789012/${this.name}`;
    
    // FIFO queue specific settings
    if (this.queueType === 'fifo') {
      this.contentBasedDeduplication = config.contentBasedDeduplication || false;
      this.deduplicationScope = config.deduplicationScope || 'queue'; // queue or messageGroup
      this.fifoThroughputLimit = config.fifoThroughputLimit || 'perQueue'; // perQueue or perMessageGroupId
      this.highThroughputFifo = config.highThroughputFifo || false;
      
      // FIFO queues have lower throughput
      this.capacity = this.highThroughputFifo ? 9000 : 300; // messages per second
    }
    
    // Message configuration
    this.messageRetentionPeriod = config.messageRetentionPeriod || 345600; // 4 days in seconds
    this.maxMessageSize = config.maxMessageSize || 262144; // 256 KB
    this.visibilityTimeout = config.visibilityTimeout || 30; // seconds
    this.receiveMessageWaitTime = config.receiveMessageWaitTime || 0; // long polling
    this.maxReceiveCount = config.maxReceiveCount || 10;
    
    // Dead Letter Queue configuration
    this.deadLetterQueue = {
      enabled: config.deadLetterQueue?.enabled || false,
      targetArn: config.deadLetterQueue?.targetArn || null,
      maxReceiveCount: config.deadLetterQueue?.maxReceiveCount || 3
    };
    
    // Encryption configuration
    this.serverSideEncryption = {
      enabled: config.serverSideEncryption?.enabled || false,
      kmsKeyId: config.serverSideEncryption?.kmsKeyId || 'alias/aws/sqs',
      keyReusePeriod: config.serverSideEncryption?.keyReusePeriod || 300 // seconds
    };
    
    // Access policy
    this.policy = config.policy || null;
    this.tags = config.tags || {};
    
    // Queue storage and processing
    this.messages = new Map(); // messageId -> message object
    this.inFlightMessages = new Map(); // messageId -> message with receipt handle
    this.deadLetterMessages = new Map(); // messageId -> failed message
    
    // Message groups for FIFO queues
    this.messageGroups = new Map(); // groupId -> array of message IDs
    this.groupSequenceNumbers = new Map(); // groupId -> next sequence number
    
    // Queue metrics
    this.queueMetrics = {
      approximateNumberOfMessages: 0,
      approximateNumberOfMessagesNotVisible: 0,
      approximateNumberOfMessagesDelayed: 0,
      messagesReceived: 0,
      messagesSent: 0,
      messagesDeleted: 0,
      oldestMessageAge: 0
    };
    
    // AWS-specific performance characteristics
    this.latencyBase = 10; // Base queue latency
    this.latencyMultiplier = 0.8; // Good scaling for queue operations
    this.degradationThreshold = 0.9; // High capacity before degradation
    this.failureThreshold = 2.0; // Can handle significant overload
    
    // Batch operation support
    this.maxBatchSize = 10; // Maximum messages per batch operation
    this.batchingEnabled = config.batchingEnabled || true;
    
    // Message deduplication (for FIFO)
    this.deduplicationIds = new Set(); // Track recent deduplication IDs
    this.deduplicationWindow = 5 * 60 * 1000; // 5 minutes in milliseconds
  }
  
  /**
   * Process queue requests (send/receive/delete messages)
   */
  processRequests(requests) {
    if (!requests || requests.length === 0) {
      return { processed: [], dropped: [] };
    }
    
    const processed = [];
    const dropped = [];
    let totalLatency = 0;
    
    // Calculate current load ratio
    const loadRatio = requests.length / this.capacity;
    this.currentLoad = loadRatio;
    
    // Update health based on load
    this.updateHealth(loadRatio);
    
    // Process each queue request
    for (const request of requests) {
      if (this.shouldDropRequest(loadRatio)) {
        dropped.push(request);
        continue;
      }
      
      // Process queue operation
      const queueResult = this.processQueueOperation(request);
      
      // Calculate latency with queue-specific factors
      const latency = this.calculateQueueLatency(loadRatio, queueResult);
      request.latency += latency;
      totalLatency += latency;
      
      // Mark request as processed by AWS SQS
      request.provider = 'aws';
      request.service = 'sqs';
      request.queueType = this.queueType;
      request.operation = queueResult.operation;
      
      processed.push(request);
    }
    
    // Update queue metrics
    this.updateQueueMetrics(processed.length, dropped.length);
    
    // Clean up old messages and deduplication IDs
    this.cleanupExpiredData();
    
    // Update base metrics
    this.updateMetrics(processed.length, dropped.length, totalLatency);
    
    return { processed, dropped };
  }
  
  /**
   * Process individual queue operation
   */
  processQueueOperation(request) {
    const operation = request.queueOperation || 'sendMessage';
    let result = { operation, success: false };
    
    switch (operation) {
      case 'sendMessage':
        result = this.sendMessage(request);
        break;
      case 'receiveMessage':
        result = this.receiveMessage(request);
        break;
      case 'deleteMessage':
        result = this.deleteMessage(request);
        break;
      case 'changeMessageVisibility':
        result = this.changeMessageVisibility(request);
        break;
      case 'purgeQueue':
        result = this.purgeQueue(request);
        break;
      default:
        result = { operation, success: false, error: 'Unknown operation' };
    }
    
    return result;
  }
  
  /**
   * Send message to queue
   */
  sendMessage(request) {
    const messageBody = request.messageBody || 'Default message body';
    const messageId = this.generateMessageId();
    
    // FIFO queue validation
    if (this.queueType === 'fifo') {
      const messageGroupId = request.messageGroupId;
      if (!messageGroupId) {
        return { operation: 'sendMessage', success: false, error: 'MessageGroupId required for FIFO queue' };
      }
      
      // Check for duplicate message
      const deduplicationId = request.deduplicationId || this.generateDeduplicationId(messageBody);
      if (this.deduplicationIds.has(deduplicationId)) {
        return { operation: 'sendMessage', success: false, error: 'Duplicate message' };
      }
      
      this.deduplicationIds.add(deduplicationId);
      
      // Add to message group
      if (!this.messageGroups.has(messageGroupId)) {
        this.messageGroups.set(messageGroupId, []);
        this.groupSequenceNumbers.set(messageGroupId, 1);
      }
      
      const sequenceNumber = this.groupSequenceNumbers.get(messageGroupId);
      this.groupSequenceNumbers.set(messageGroupId, sequenceNumber + 1);
    }
    
    // Create message
    const message = {
      messageId: messageId,
      body: messageBody,
      attributes: request.messageAttributes || {},
      systemAttributes: {
        sentTimestamp: Date.now(),
        senderId: request.senderId || 'anonymous',
        approximateReceiveCount: 0,
        approximateFirstReceiveTimestamp: null
      },
      md5OfBody: this.calculateMD5(messageBody),
      receiptHandle: null,
      visibilityTimeout: this.visibilityTimeout,
      delaySeconds: request.delaySeconds || 0
    };
    
    // Add FIFO-specific attributes
    if (this.queueType === 'fifo') {
      message.messageGroupId = request.messageGroupId;
      message.messageDeduplicationId = request.deduplicationId || this.generateDeduplicationId(messageBody);
      message.sequenceNumber = this.groupSequenceNumbers.get(request.messageGroupId) - 1;
    }
    
    // Store message
    this.messages.set(messageId, message);
    this.queueMetrics.messagesSent++;
    
    return { operation: 'sendMessage', success: true, messageId: messageId };
  }
  
  /**
   * Receive message from queue
   */
  receiveMessage(request) {
    const maxMessages = Math.min(request.maxNumberOfMessages || 1, this.maxBatchSize);
    const waitTimeSeconds = request.waitTimeSeconds || this.receiveMessageWaitTime;
    
    const receivedMessages = [];
    
    // Get available messages
    const availableMessages = Array.from(this.messages.values())
      .filter(msg => !this.inFlightMessages.has(msg.messageId))
      .filter(msg => this.isMessageVisible(msg))
      .slice(0, maxMessages);
    
    // For FIFO queues, maintain order within message groups
    if (this.queueType === 'fifo') {
      availableMessages.sort((a, b) => {
        if (a.messageGroupId !== b.messageGroupId) {
          return a.messageGroupId.localeCompare(b.messageGroupId);
        }
        return a.sequenceNumber - b.sequenceNumber;
      });
    }
    
    // Process received messages
    for (const message of availableMessages) {
      const receiptHandle = this.generateReceiptHandle();
      message.receiptHandle = receiptHandle;
      message.systemAttributes.approximateReceiveCount++;
      message.systemAttributes.approximateFirstReceiveTimestamp = message.systemAttributes.approximateFirstReceiveTimestamp || Date.now();
      
      // Move to in-flight
      this.inFlightMessages.set(message.messageId, message);
      
      receivedMessages.push({
        messageId: message.messageId,
        receiptHandle: receiptHandle,
        body: message.body,
        attributes: message.attributes,
        md5OfBody: message.md5OfBody
      });
      
      this.queueMetrics.messagesReceived++;
    }
    
    return { operation: 'receiveMessage', success: true, messages: receivedMessages };
  }
  
  /**
   * Delete message from queue
   */
  deleteMessage(request) {
    const receiptHandle = request.receiptHandle;
    
    if (!receiptHandle) {
      return { operation: 'deleteMessage', success: false, error: 'ReceiptHandle required' };
    }
    
    // Find message by receipt handle
    let messageToDelete = null;
    for (const message of this.inFlightMessages.values()) {
      if (message.receiptHandle === receiptHandle) {
        messageToDelete = message;
        break;
      }
    }
    
    if (!messageToDelete) {
      return { operation: 'deleteMessage', success: false, error: 'Invalid ReceiptHandle' };
    }
    
    // Remove from both maps
    this.messages.delete(messageToDelete.messageId);
    this.inFlightMessages.delete(messageToDelete.messageId);
    
    this.queueMetrics.messagesDeleted++;
    
    return { operation: 'deleteMessage', success: true };
  }
  
  /**
   * Change message visibility timeout
   */
  changeMessageVisibility(request) {
    const receiptHandle = request.receiptHandle;
    const visibilityTimeout = request.visibilityTimeout;
    
    if (!receiptHandle || visibilityTimeout === undefined) {
      return { operation: 'changeMessageVisibility', success: false, error: 'ReceiptHandle and VisibilityTimeout required' };
    }
    
    // Find message by receipt handle
    let messageToUpdate = null;
    for (const message of this.inFlightMessages.values()) {
      if (message.receiptHandle === receiptHandle) {
        messageToUpdate = message;
        break;
      }
    }
    
    if (!messageToUpdate) {
      return { operation: 'changeMessageVisibility', success: false, error: 'Invalid ReceiptHandle' };
    }
    
    messageToUpdate.visibilityTimeout = visibilityTimeout;
    messageToUpdate.visibilityStartTime = Date.now();
    
    return { operation: 'changeMessageVisibility', success: true };
  }
  
  /**
   * Purge all messages from queue
   */
  purgeQueue(request) {
    this.messages.clear();
    this.inFlightMessages.clear();
    
    if (this.queueType === 'fifo') {
      this.messageGroups.clear();
      this.groupSequenceNumbers.clear();
    }
    
    return { operation: 'purgeQueue', success: true };
  }
  
  /**
   * Check if message is visible (not in visibility timeout)
   */
  isMessageVisible(message) {
    if (!message.visibilityStartTime) {
      return true;
    }
    
    const now = Date.now();
    const visibilityEnd = message.visibilityStartTime + (message.visibilityTimeout * 1000);
    
    return now > visibilityEnd;
  }
  
  /**
   * Generate unique message ID
   */
  generateMessageId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Generate receipt handle
   */
  generateReceiptHandle() {
    return `receipt-${Date.now()}-${Math.random().toString(36).substr(2, 16)}`;
  }
  
  /**
   * Generate deduplication ID for FIFO queues
   */
  generateDeduplicationId(messageBody) {
    if (this.contentBasedDeduplication) {
      return this.calculateMD5(messageBody);
    }
    return `dedup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Calculate MD5 hash (simplified)
   */
  calculateMD5(content) {
    // Simplified MD5 simulation
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
  
  /**
   * Calculate queue-specific latency
   */
  calculateQueueLatency(loadRatio, queueResult) {
    let latency = this.calculateLatency(loadRatio);
    
    // Operation type affects latency
    switch (queueResult.operation) {
      case 'sendMessage':
        latency *= 1.0; // Baseline
        break;
      case 'receiveMessage':
        latency *= 1.2; // Slightly slower
        break;
      case 'deleteMessage':
        latency *= 0.8; // Faster
        break;
      case 'changeMessageVisibility':
        latency *= 0.9; // Fast operation
        break;
    }
    
    // FIFO queues have slightly higher latency due to ordering
    if (this.queueType === 'fifo') {
      latency *= 1.1; // 10% overhead for FIFO ordering
    }
    
    // Encryption adds processing overhead
    if (this.serverSideEncryption.enabled) {
      latency *= 1.05; // 5% overhead for encryption
    }
    
    // Long polling reduces latency for receive operations
    if (queueResult.operation === 'receiveMessage' && this.receiveMessageWaitTime > 0) {
      latency *= 0.9; // 10% improvement with long polling
    }
    
    return Math.round(latency);
  }
  
  /**
   * Update queue-specific metrics
   */
  updateQueueMetrics(processedCount, droppedCount) {
    this.queueMetrics.approximateNumberOfMessages = this.messages.size;
    this.queueMetrics.approximateNumberOfMessagesNotVisible = this.inFlightMessages.size;
    
    // Calculate oldest message age
    let oldestTimestamp = Date.now();
    for (const message of this.messages.values()) {
      if (message.systemAttributes.sentTimestamp < oldestTimestamp) {
        oldestTimestamp = message.systemAttributes.sentTimestamp;
      }
    }
    
    this.queueMetrics.oldestMessageAge = this.messages.size > 0 ? 
      Math.floor((Date.now() - oldestTimestamp) / 1000) : 0;
  }
  
  /**
   * Clean up expired data
   */
  cleanupExpiredData() {
    const now = Date.now();
    
    // Remove expired messages
    for (const [messageId, message] of this.messages) {
      const messageAge = (now - message.systemAttributes.sentTimestamp) / 1000;
      if (messageAge > this.messageRetentionPeriod) {
        this.messages.delete(messageId);
      }
    }
    
    // Remove expired deduplication IDs
    if (this.queueType === 'fifo') {
      // In a real implementation, we'd track timestamps for deduplication IDs
      // For simplicity, we'll clear them periodically
      if (this.deduplicationIds.size > 1000) {
        this.deduplicationIds.clear();
      }
    }
    
    // Handle dead letter queue
    if (this.deadLetterQueue.enabled) {
      for (const [messageId, message] of this.inFlightMessages) {
        if (message.systemAttributes.approximateReceiveCount >= this.deadLetterQueue.maxReceiveCount) {
          this.deadLetterMessages.set(messageId, message);
          this.inFlightMessages.delete(messageId);
          this.messages.delete(messageId);
        }
      }
    }
  }
  
  /**
   * Get AWS SQS-specific cost calculation
   */
  getCost() {
    let cost = 0;
    
    // SQS pricing per 1M requests
    const standardQueueCost = 0.40 / 1000000; // $0.40 per 1M requests
    const fifoQueueCost = 0.50 / 1000000; // $0.50 per 1M requests
    
    const requestCost = this.queueType === 'fifo' ? fifoQueueCost : standardQueueCost;
    const totalRequests = this.queueMetrics.messagesSent + this.queueMetrics.messagesReceived + this.queueMetrics.messagesDeleted;
    
    cost += totalRequests * requestCost;
    
    // Data transfer costs (simplified)
    const dataTransferCost = totalRequests * 0.000001; // $0.000001 per request
    cost += dataTransferCost;
    
    // KMS encryption costs
    if (this.serverSideEncryption.enabled && this.serverSideEncryption.kmsKeyId !== 'alias/aws/sqs') {
      const kmsRequestCost = 0.03 / 10000; // $0.03 per 10,000 requests
      cost += totalRequests * kmsRequestCost;
    }
    
    return cost;
  }
  
  /**
   * Get SQS-specific status
   */
  getStatus() {
    const baseStatus = super.getStatus();
    
    return {
      ...baseStatus,
      type: this.type,
      queueType: this.queueType,
      queueUrl: this.queueUrl,
      messageRetentionPeriod: this.messageRetentionPeriod,
      visibilityTimeout: this.visibilityTimeout,
      maxMessageSize: this.maxMessageSize,
      queueMetrics: { ...this.queueMetrics },
      deadLetterQueue: { ...this.deadLetterQueue },
      serverSideEncryption: { ...this.serverSideEncryption },
      fifoSettings: this.queueType === 'fifo' ? {
        contentBasedDeduplication: this.contentBasedDeduplication,
        deduplicationScope: this.deduplicationScope,
        fifoThroughputLimit: this.fifoThroughputLimit,
        highThroughputFifo: this.highThroughputFifo
      } : null
    };
  }
  
  /**
   * Validate SQS configuration
   */
  validate() {
    const errors = super.validate();
    
    if (!['standard', 'fifo'].includes(this.queueType)) {
      errors.push('Invalid queue type - must be standard or fifo');
    }
    
    if (this.messageRetentionPeriod < 60 || this.messageRetentionPeriod > 1209600) {
      errors.push('Message retention period must be between 60 seconds and 14 days');
    }
    
    if (this.visibilityTimeout < 0 || this.visibilityTimeout > 43200) {
      errors.push('Visibility timeout must be between 0 and 12 hours');
    }
    
    if (this.maxMessageSize < 1024 || this.maxMessageSize > 262144) {
      errors.push('Max message size must be between 1KB and 256KB');
    }
    
    if (this.receiveMessageWaitTime < 0 || this.receiveMessageWaitTime > 20) {
      errors.push('Receive message wait time must be between 0 and 20 seconds');
    }
    
    if (this.queueType === 'fifo') {
      if (!['queue', 'messageGroup'].includes(this.deduplicationScope)) {
        errors.push('Invalid deduplication scope for FIFO queue');
      }
      
      if (!['perQueue', 'perMessageGroupId'].includes(this.fifoThroughputLimit)) {
        errors.push('Invalid FIFO throughput limit');
      }
    }
    
    return errors;
  }
}