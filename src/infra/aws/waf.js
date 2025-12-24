/**
 * AWS WAF (Web Application Firewall) implementation
 * Provides rule-based filtering and AWS-specific security features
 */
import { BaseService } from '../baseService.js';

export class AWSWAF extends BaseService {
  constructor(config = {}) {
    super(
      config.name || 'AWS-WAF',
      'aws',
      config.capacity || 25000, // requests per second
      config.baseCost || 0.60 // $0.60 per month base + per-request costs
    );
    
    // AWS WAF specific configuration
    this.type = 'waf';
    this.scope = config.scope || 'CLOUDFRONT'; // CLOUDFRONT or REGIONAL
    this.defaultAction = config.defaultAction || 'ALLOW'; // ALLOW or BLOCK
    
    // Web ACL configuration
    this.webAclId = config.webAclId || this.generateWebAclId();
    this.webAclArn = config.webAclArn || this.generateWebAclArn();
    
    // Rules configuration
    this.rules = new Map(); // ruleId -> rule configuration
    this.managedRuleGroups = new Map(); // groupId -> managed rule group
    this.customRules = new Map(); // ruleId -> custom rule
    this.rateBasedRules = new Map(); // ruleId -> rate-based rule
    
    // AWS Managed Rules (common rule groups)
    this.enabledManagedRules = config.enabledManagedRules || [
      'AWSManagedRulesCommonRuleSet',
      'AWSManagedRulesKnownBadInputsRuleSet',
      'AWSManagedRulesAmazonIpReputationList'
    ];
    
    // IP sets and regex pattern sets
    this.ipSets = new Map(); // setId -> IP set configuration
    this.regexPatternSets = new Map(); // setId -> regex pattern set
    
    // Logging configuration
    this.logging = {
      enabled: config.logging?.enabled || false,
      logDestination: config.logging?.logDestination || null,
      redactedFields: config.logging?.redactedFields || []
    };
    
    // Sampling configuration for logging
    this.samplingRate = config.samplingRate || 100; // Percentage of requests to log
    
    // WAF metrics and statistics
    this.wafMetrics = {
      allowedRequests: 0,
      blockedRequests: 0,
      countedRequests: 0,
      captchaRequests: 0,
      challengeRequests: 0,
      ruleMatches: new Map(), // ruleId -> match count
      falsePositives: 0,
      truePositives: 0
    };
    
    // Request inspection capabilities
    this.inspectionCapabilities = {
      headers: true,
      cookies: true,
      queryString: true,
      uriPath: true,
      body: true,
      method: true,
      ipAddress: true,
      geoLocation: true,
      userAgent: true
    };
    
    // AWS-specific performance characteristics
    this.latencyBase = 2; // Very low latency for WAF inspection
    this.latencyMultiplier = 0.4; // Excellent scaling
    this.degradationThreshold = 0.95; // Very high capacity before degradation
    this.failureThreshold = 2.5; // Can handle significant overload
    
    // Machine learning capabilities
    this.mlCapabilities = {
      botControl: config.mlCapabilities?.botControl || false,
      fraudControl: config.mlCapabilities?.fraudControl || false,
      accountTakeover: config.mlCapabilities?.accountTakeover || false
    };
    
    // CAPTCHA and Challenge configurations
    this.captchaConfig = {
      enabled: config.captchaConfig?.enabled || false,
      immunityTime: config.captchaConfig?.immunityTime || 300, // seconds
      customResponseBody: config.captchaConfig?.customResponseBody || null
    };
    
    // Initialize default managed rules
    this.initializeManagedRules();
  }
  
  /**
   * Initialize AWS Managed Rules
   */
  initializeManagedRules() {
    for (const ruleGroupName of this.enabledManagedRules) {
      this.addManagedRuleGroup(ruleGroupName, {
        priority: this.managedRuleGroups.size + 1,
        overrideAction: 'NONE',
        excludedRules: []
      });
    }
  }
  
  /**
   * Process requests through WAF inspection
   */
  processRequests(requests) {
    if (!requests || requests.length === 0) {
      return { processed: [], dropped: [], blocked: [] };
    }
    
    const processed = [];
    const dropped = [];
    const blocked = [];
    let totalLatency = 0;
    
    // Calculate current load ratio
    const loadRatio = requests.length / this.capacity;
    this.currentLoad = loadRatio;
    
    // Update health based on load
    this.updateHealth(loadRatio);
    
    // Process each request through WAF rules
    for (const request of requests) {
      if (this.shouldDropRequest(loadRatio)) {
        dropped.push(request);
        continue;
      }
      
      // Inspect request through WAF rules
      const inspectionResult = this.inspectRequest(request);
      
      // Calculate latency with WAF-specific factors
      const latency = this.calculateWAFLatency(loadRatio, inspectionResult);
      request.latency += latency;
      totalLatency += latency;
      
      // Mark request as processed by AWS WAF
      request.provider = 'aws';
      request.service = 'waf';
      request.wafAction = inspectionResult.action;
      request.matchedRules = inspectionResult.matchedRules;
      
      // Handle WAF action
      switch (inspectionResult.action) {
        case 'ALLOW':
          this.wafMetrics.allowedRequests++;
          processed.push(request);
          break;
        case 'BLOCK':
          this.wafMetrics.blockedRequests++;
          blocked.push(request);
          break;
        case 'COUNT':
          this.wafMetrics.countedRequests++;
          processed.push(request); // COUNT allows but logs
          break;
        case 'CAPTCHA':
          this.wafMetrics.captchaRequests++;
          request.requiresCaptcha = true;
          processed.push(request);
          break;
        case 'CHALLENGE':
          this.wafMetrics.challengeRequests++;
          request.requiresChallenge = true;
          processed.push(request);
          break;
      }
    }
    
    // Update WAF metrics
    this.updateWAFMetrics(processed.length, dropped.length, blocked.length);
    
    // Update base metrics
    this.updateMetrics(processed.length, dropped.length, totalLatency);
    
    return { processed, dropped, blocked };
  }
  
  /**
   * Inspect request through WAF rules
   */
  inspectRequest(request) {
    const matchedRules = [];
    let finalAction = this.defaultAction;
    let terminatingRule = null;
    
    // Get rules sorted by priority
    const sortedRules = this.getSortedRules();
    
    // Inspect against each rule
    for (const rule of sortedRules) {
      const ruleResult = this.evaluateRule(request, rule);
      
      if (ruleResult.matches) {
        matchedRules.push({
          ruleId: rule.id,
          ruleName: rule.name,
          action: ruleResult.action
        });
        
        // Update rule match statistics
        const currentCount = this.wafMetrics.ruleMatches.get(rule.id) || 0;
        this.wafMetrics.ruleMatches.set(rule.id, currentCount + 1);
        
        // Check if this is a terminating action
        if (['BLOCK', 'ALLOW', 'CAPTCHA', 'CHALLENGE'].includes(ruleResult.action)) {
          finalAction = ruleResult.action;
          terminatingRule = rule.id;
          break; // Terminating action stops further rule evaluation
        } else if (ruleResult.action === 'COUNT') {
          // COUNT action continues to next rule but logs the match
          continue;
        }
      }
    }
    
    return {
      action: finalAction,
      matchedRules: matchedRules,
      terminatingRule: terminatingRule
    };
  }
  
  /**
   * Evaluate individual rule against request
   */
  evaluateRule(request, rule) {
    let matches = false;
    
    // Evaluate rule conditions based on rule type
    switch (rule.type) {
      case 'MANAGED':
        matches = this.evaluateManagedRule(request, rule);
        break;
      case 'CUSTOM':
        matches = this.evaluateCustomRule(request, rule);
        break;
      case 'RATE_BASED':
        matches = this.evaluateRateBasedRule(request, rule);
        break;
      case 'GEO_MATCH':
        matches = this.evaluateGeoMatchRule(request, rule);
        break;
      case 'IP_SET':
        matches = this.evaluateIPSetRule(request, rule);
        break;
      case 'REGEX':
        matches = this.evaluateRegexRule(request, rule);
        break;
    }
    
    return {
      matches: matches,
      action: matches ? rule.action : 'CONTINUE'
    };
  }
  
  /**
   * Evaluate managed rule
   */
  evaluateManagedRule(request, rule) {
    // Simulate AWS Managed Rules behavior
    switch (rule.managedRuleGroup) {
      case 'AWSManagedRulesCommonRuleSet':
        return this.evaluateCommonRuleSet(request);
      case 'AWSManagedRulesKnownBadInputsRuleSet':
        return this.evaluateKnownBadInputs(request);
      case 'AWSManagedRulesAmazonIpReputationList':
        return this.evaluateIpReputation(request);
      case 'AWSManagedRulesBotControlRuleSet':
        return this.evaluateBotControl(request);
      default:
        return false;
    }
  }
  
  /**
   * Evaluate common rule set (SQL injection, XSS, etc.)
   */
  evaluateCommonRuleSet(request) {
    const maliciousPatterns = [
      /union.*select/i,
      /<script.*>/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /\'\s*or\s*\'/i,
      /\"\s*or\s*\"/i
    ];
    
    const requestContent = [
      request.path,
      request.queryString,
      request.userAgent,
      JSON.stringify(request.headers || {}),
      request.body
    ].join(' ').toLowerCase();
    
    return maliciousPatterns.some(pattern => pattern.test(requestContent));
  }
  
  /**
   * Evaluate known bad inputs
   */
  evaluateKnownBadInputs(request) {
    const badInputPatterns = [
      /\.\.\/\.\.\//,  // Directory traversal
      /\/etc\/passwd/,  // System file access
      /cmd\.exe/i,      // Command execution
      /powershell/i,    // PowerShell execution
      /%00/,            // Null byte injection
    ];
    
    const requestContent = [request.path, request.queryString, request.body].join(' ');
    return badInputPatterns.some(pattern => pattern.test(requestContent));
  }
  
  /**
   * Evaluate IP reputation
   */
  evaluateIpReputation(request) {
    // Simulate malicious IP detection
    const clientIp = request.clientIp || request.sourceIp || '127.0.0.1';
    
    // Simple simulation: IPs ending in certain patterns are "malicious"
    const maliciousPatterns = ['.666', '.999', '.123.123'];
    return maliciousPatterns.some(pattern => clientIp.includes(pattern));
  }
  
  /**
   * Evaluate bot control
   */
  evaluateBotControl(request) {
    if (!this.mlCapabilities.botControl) {
      return false;
    }
    
    const userAgent = request.userAgent || '';
    const botPatterns = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /scraper/i,
      /curl/i,
      /wget/i
    ];
    
    return botPatterns.some(pattern => pattern.test(userAgent));
  }
  
  /**
   * Evaluate custom rule
   */
  evaluateCustomRule(request, rule) {
    // Simplified custom rule evaluation
    const conditions = rule.conditions || [];
    
    return conditions.every(condition => {
      const fieldValue = this.extractFieldValue(request, condition.field);
      return this.evaluateCondition(fieldValue, condition);
    });
  }
  
  /**
   * Evaluate rate-based rule
   */
  evaluateRateBasedRule(request, rule) {
    // Simplified rate limiting simulation
    const key = this.getRateLimitKey(request, rule.aggregateKeyType);
    const now = Date.now();
    const windowStart = now - (rule.rateLimit.windowSize * 1000);
    
    // In a real implementation, this would use a sliding window counter
    // For simulation, we'll use a simple random check
    return Math.random() < 0.1; // 10% chance of rate limit hit
  }
  
  /**
   * Evaluate geo match rule
   */
  evaluateGeoMatchRule(request, rule) {
    const clientCountry = request.geoLocation?.country || 'US';
    return rule.countryCodes?.includes(clientCountry) || false;
  }
  
  /**
   * Evaluate IP set rule
   */
  evaluateIPSetRule(request, rule) {
    const clientIp = request.clientIp || request.sourceIp || '127.0.0.1';
    const ipSet = this.ipSets.get(rule.ipSetId);
    
    if (!ipSet) {
      return false;
    }
    
    return ipSet.addresses.some(address => {
      if (address.includes('/')) {
        // CIDR notation - simplified check
        const network = address.split('/')[0];
        return clientIp.startsWith(network.substring(0, network.lastIndexOf('.')));
      } else {
        // Exact IP match
        return clientIp === address;
      }
    });
  }
  
  /**
   * Evaluate regex rule
   */
  evaluateRegexRule(request, rule) {
    const regexSet = this.regexPatternSets.get(rule.regexSetId);
    if (!regexSet) {
      return false;
    }
    
    const fieldValue = this.extractFieldValue(request, rule.fieldToMatch);
    return regexSet.patterns.some(pattern => {
      try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(fieldValue);
      } catch (e) {
        return false;
      }
    });
  }
  
  /**
   * Extract field value from request
   */
  extractFieldValue(request, field) {
    switch (field.type) {
      case 'URI':
        return request.path || '';
      case 'QUERY_STRING':
        return request.queryString || '';
      case 'HEADER':
        return request.headers?.[field.name] || '';
      case 'METHOD':
        return request.method || 'GET';
      case 'BODY':
        return request.body || '';
      case 'SINGLE_HEADER':
        return request.headers?.[field.name] || '';
      default:
        return '';
    }
  }
  
  /**
   * Evaluate condition
   */
  evaluateCondition(fieldValue, condition) {
    switch (condition.operator) {
      case 'EXACTLY_MATCHES':
        return fieldValue === condition.value;
      case 'STARTS_WITH':
        return fieldValue.startsWith(condition.value);
      case 'ENDS_WITH':
        return fieldValue.endsWith(condition.value);
      case 'CONTAINS':
        return fieldValue.includes(condition.value);
      case 'CONTAINS_WORD':
        return new RegExp(`\\b${condition.value}\\b`, 'i').test(fieldValue);
      case 'REGEX_MATCH':
        try {
          return new RegExp(condition.value, 'i').test(fieldValue);
        } catch (e) {
          return false;
        }
      default:
        return false;
    }
  }
  
  /**
   * Get rate limit key
   */
  getRateLimitKey(request, aggregateKeyType) {
    switch (aggregateKeyType) {
      case 'IP':
        return request.clientIp || request.sourceIp || '127.0.0.1';
      case 'FORWARDED_IP':
        return request.headers?.['x-forwarded-for'] || request.clientIp || '127.0.0.1';
      case 'CUSTOM_KEYS':
        return `${request.clientIp}-${request.userAgent}`;
      default:
        return request.clientIp || '127.0.0.1';
    }
  }
  
  /**
   * Get rules sorted by priority
   */
  getSortedRules() {
    const allRules = [
      ...Array.from(this.managedRuleGroups.values()),
      ...Array.from(this.customRules.values()),
      ...Array.from(this.rateBasedRules.values())
    ];
    
    return allRules.sort((a, b) => a.priority - b.priority);
  }
  
  /**
   * Calculate WAF-specific latency
   */
  calculateWAFLatency(loadRatio, inspectionResult) {
    let latency = this.calculateLatency(loadRatio);
    
    // Number of rules evaluated affects latency
    const rulesEvaluated = inspectionResult.matchedRules.length + 1;
    latency += rulesEvaluated * 0.1; // 0.1ms per rule
    
    // Complex rules (regex, ML) add more latency
    const hasComplexRules = inspectionResult.matchedRules.some(rule => 
      rule.ruleName.includes('Bot') || rule.ruleName.includes('Fraud')
    );
    
    if (hasComplexRules) {
      latency *= 1.5; // 50% overhead for ML-based rules
    }
    
    // Body inspection adds latency
    if (this.inspectionCapabilities.body) {
      latency += 1; // 1ms for body inspection
    }
    
    // Logging adds minimal overhead
    if (this.logging.enabled) {
      latency *= 1.02; // 2% overhead for logging
    }
    
    return Math.round(latency);
  }
  
  /**
   * Add managed rule group
   */
  addManagedRuleGroup(groupName, config) {
    const ruleId = `managed-${this.managedRuleGroups.size + 1}`;
    
    this.managedRuleGroups.set(ruleId, {
      id: ruleId,
      name: groupName,
      type: 'MANAGED',
      managedRuleGroup: groupName,
      priority: config.priority,
      action: 'BLOCK',
      overrideAction: config.overrideAction || 'NONE',
      excludedRules: config.excludedRules || []
    });
  }
  
  /**
   * Add custom rule
   */
  addCustomRule(ruleConfig) {
    const ruleId = `custom-${this.customRules.size + 1}`;
    
    this.customRules.set(ruleId, {
      id: ruleId,
      name: ruleConfig.name,
      type: 'CUSTOM',
      priority: ruleConfig.priority,
      action: ruleConfig.action,
      conditions: ruleConfig.conditions || []
    });
  }
  
  /**
   * Add IP set
   */
  addIPSet(setId, config) {
    this.ipSets.set(setId, {
      id: setId,
      name: config.name,
      scope: this.scope,
      ipAddressVersion: config.ipAddressVersion || 'IPV4',
      addresses: config.addresses || []
    });
  }
  
  /**
   * Update WAF metrics
   */
  updateWAFMetrics(processedCount, droppedCount, blockedCount) {
    // Calculate false positive rate (simplified)
    const totalBlocked = this.wafMetrics.blockedRequests;
    if (totalBlocked > 0) {
      // Assume 5% false positive rate for simulation
      this.wafMetrics.falsePositives = Math.floor(totalBlocked * 0.05);
      this.wafMetrics.truePositives = totalBlocked - this.wafMetrics.falsePositives;
    }
  }
  
  /**
   * Generate Web ACL ID
   */
  generateWebAclId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Generate Web ACL ARN
   */
  generateWebAclArn() {
    const region = 'us-east-1';
    const accountId = '123456789012';
    const scope = this.scope.toLowerCase();
    
    return `arn:aws:wafv2:${region}:${accountId}:${scope}/webacl/${this.name}/${this.webAclId}`;
  }
  
  /**
   * Get AWS WAF-specific cost calculation
   */
  getCost() {
    let cost = 0;
    
    // Base Web ACL cost
    const webAclMonthlyCost = 1.00 / (30 * 24 * 60); // $1.00 per month
    cost += webAclMonthlyCost;
    
    // Rule group costs
    const ruleGroupCost = 1.00 / (30 * 24 * 60); // $1.00 per rule group per month
    cost += this.managedRuleGroups.size * ruleGroupCost;
    
    // Request processing costs
    const totalRequests = this.wafMetrics.allowedRequests + 
                         this.wafMetrics.blockedRequests + 
                         this.wafMetrics.countedRequests;
    
    const requestCost = 0.60 / 1000000; // $0.60 per 1M requests
    cost += totalRequests * requestCost;
    
    // Bot Control costs (if enabled)
    if (this.mlCapabilities.botControl) {
      const botControlCost = 1.00 / 1000000; // $1.00 per 1M requests
      cost += totalRequests * botControlCost;
    }
    
    // Fraud Control costs (if enabled)
    if (this.mlCapabilities.fraudControl) {
      const fraudControlCost = 7.50 / 1000000; // $7.50 per 1M requests
      cost += totalRequests * fraudControlCost;
    }
    
    // CAPTCHA costs
    const captchaCost = 0.40 / 1000; // $0.40 per 1,000 CAPTCHA challenges
    cost += this.wafMetrics.captchaRequests * captchaCost;
    
    return cost;
  }
  
  /**
   * Get WAF-specific status
   */
  getStatus() {
    const baseStatus = super.getStatus();
    
    return {
      ...baseStatus,
      type: this.type,
      scope: this.scope,
      webAclId: this.webAclId,
      defaultAction: this.defaultAction,
      managedRuleGroups: Array.from(this.managedRuleGroups.values()),
      customRules: Array.from(this.customRules.values()),
      wafMetrics: { 
        ...this.wafMetrics,
        ruleMatches: Object.fromEntries(this.wafMetrics.ruleMatches)
      },
      mlCapabilities: { ...this.mlCapabilities },
      logging: { ...this.logging },
      inspectionCapabilities: { ...this.inspectionCapabilities }
    };
  }
  
  /**
   * Validate WAF configuration
   */
  validate() {
    const errors = super.validate();
    
    if (!['CLOUDFRONT', 'REGIONAL'].includes(this.scope)) {
      errors.push('Invalid scope - must be CLOUDFRONT or REGIONAL');
    }
    
    if (!['ALLOW', 'BLOCK'].includes(this.defaultAction)) {
      errors.push('Invalid default action - must be ALLOW or BLOCK');
    }
    
    if (this.samplingRate < 0 || this.samplingRate > 100) {
      errors.push('Sampling rate must be between 0 and 100');
    }
    
    // Validate rule priorities are unique
    const priorities = new Set();
    const allRules = this.getSortedRules();
    
    for (const rule of allRules) {
      if (priorities.has(rule.priority)) {
        errors.push(`Duplicate rule priority: ${rule.priority}`);
      }
      priorities.add(rule.priority);
    }
    
    return errors;
  }
}