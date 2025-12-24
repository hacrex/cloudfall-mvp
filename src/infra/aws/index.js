/**
 * AWS Infrastructure Services
 * Exports all AWS-specific service implementations
 */

export { AWSLoadBalancer } from './loadBalancer.js';
export { AWSCompute } from './compute.js';
export { AWSCache } from './cache.js';
export { AWSDatabase } from './database.js';
export { AWSQueue } from './queue.js';
export { AWSWAF } from './waf.js';

/**
 * AWS Service Factory
 * Creates AWS services with provider-specific configurations
 */
export class AWSServiceFactory {
  /**
   * Create AWS Load Balancer (ALB)
   */
  static createLoadBalancer(config = {}) {
    return new AWSLoadBalancer({
      name: config.name || 'AWS-ALB',
      scheme: config.scheme || 'internet-facing',
      capacity: config.capacity || 1000,
      baseCost: config.baseCost || 0.025,
      healthCheck: config.healthCheck || { enabled: true },
      stickySessions: config.stickySessions || false,
      crossZoneEnabled: config.crossZoneEnabled || true,
      ...config
    });
  }
  
  /**
   * Create AWS Compute (EC2)
   */
  static createCompute(config = {}) {
    return new AWSCompute({
      name: config.name || 'AWS-EC2',
      instanceType: config.instanceType || 't3.medium',
      capacity: config.capacity || 500,
      baseCost: config.baseCost || 0.05,
      autoScaling: config.autoScaling || { enabled: false },
      spotInstance: config.spotInstance || false,
      reservedInstance: config.reservedInstance || false,
      ...config
    });
  }
  
  /**
   * Create AWS Cache (ElastiCache)
   */
  static createCache(config = {}) {
    return new AWSCache({
      name: config.name || 'AWS-ElastiCache',
      engine: config.engine || 'redis',
      nodeType: config.nodeType || 'cache.t3.micro',
      capacity: config.capacity || 10000,
      baseCost: config.baseCost || 0.034,
      multiAZ: config.multiAZ || false,
      clusterMode: config.clusterMode || false,
      ...config
    });
  }
  
  /**
   * Create AWS Database (RDS)
   */
  static createDatabase(config = {}) {
    return new AWSDatabase({
      name: config.name || 'AWS-RDS',
      engine: config.engine || 'mysql',
      instanceClass: config.instanceClass || 'db.t3.micro',
      capacity: config.capacity || 1000,
      baseCost: config.baseCost || 0.017,
      multiAZ: config.multiAZ || false,
      readReplicas: config.readReplicas || [],
      storageType: config.storageType || 'gp2',
      ...config
    });
  }
  
  /**
   * Create AWS Queue (SQS)
   */
  static createQueue(config = {}) {
    return new AWSQueue({
      name: config.name || 'AWS-SQS',
      queueType: config.queueType || 'standard',
      capacity: config.capacity || 3000,
      baseCost: config.baseCost || 0.0004,
      visibilityTimeout: config.visibilityTimeout || 30,
      messageRetentionPeriod: config.messageRetentionPeriod || 345600,
      deadLetterQueue: config.deadLetterQueue || { enabled: false },
      ...config
    });
  }
  
  /**
   * Create AWS WAF
   */
  static createWAF(config = {}) {
    return new AWSWAF({
      name: config.name || 'AWS-WAF',
      scope: config.scope || 'CLOUDFRONT',
      capacity: config.capacity || 25000,
      baseCost: config.baseCost || 0.60,
      defaultAction: config.defaultAction || 'ALLOW',
      enabledManagedRules: config.enabledManagedRules || [
        'AWSManagedRulesCommonRuleSet',
        'AWSManagedRulesKnownBadInputsRuleSet',
        'AWSManagedRulesAmazonIpReputationList'
      ],
      mlCapabilities: config.mlCapabilities || { botControl: false },
      ...config
    });
  }
  
  /**
   * Get all available AWS service types
   */
  static getAvailableServices() {
    return [
      {
        type: 'loadbalancer',
        name: 'Application Load Balancer (ALB)',
        description: 'Advanced Layer 7 load balancing with content-based routing',
        factory: this.createLoadBalancer
      },
      {
        type: 'compute',
        name: 'Elastic Compute Cloud (EC2)',
        description: 'Scalable virtual servers with burstable performance',
        factory: this.createCompute
      },
      {
        type: 'cache',
        name: 'ElastiCache',
        description: 'In-memory caching with Redis and Memcached support',
        factory: this.createCache
      },
      {
        type: 'database',
        name: 'Relational Database Service (RDS)',
        description: 'Managed relational databases with Multi-AZ support',
        factory: this.createDatabase
      },
      {
        type: 'queue',
        name: 'Simple Queue Service (SQS)',
        description: 'Fully managed message queuing with FIFO support',
        factory: this.createQueue
      },
      {
        type: 'waf',
        name: 'Web Application Firewall (WAF)',
        description: 'Advanced web application protection with managed rules',
        factory: this.createWAF
      }
    ];
  }
  
  /**
   * Create service by type
   */
  static createService(type, config = {}) {
    switch (type.toLowerCase()) {
      case 'loadbalancer':
      case 'alb':
        return this.createLoadBalancer(config);
      case 'compute':
      case 'ec2':
        return this.createCompute(config);
      case 'cache':
      case 'elasticache':
        return this.createCache(config);
      case 'database':
      case 'rds':
        return this.createDatabase(config);
      case 'queue':
      case 'sqs':
        return this.createQueue(config);
      case 'waf':
        return this.createWAF(config);
      default:
        throw new Error(`Unknown AWS service type: ${type}`);
    }
  }
}

/**
 * AWS Provider Configuration
 */
export const AWSProvider = {
  name: 'aws',
  displayName: 'Amazon Web Services',
  region: 'us-east-1',
  colors: {
    primary: '#ff9900',
    secondary: '#232f3e',
    success: '#00d4aa',
    warning: '#ffb000',
    error: '#d13212'
  },
  services: AWSServiceFactory.getAvailableServices(),
  
  /**
   * Get provider-specific integration bonuses
   */
  getIntegrationBonus() {
    return 0.1; // 10% performance bonus for same-provider services
  },
  
  /**
   * Get cross-provider penalty
   */
  getCrossProviderPenalty() {
    return 0.15; // 15% latency penalty for cross-provider communication
  },
  
  /**
   * Validate provider configuration
   */
  validate(config) {
    const errors = [];
    
    if (!config.region) {
      errors.push('AWS region is required');
    }
    
    const validRegions = [
      'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'eu-west-1', 'eu-west-2', 'eu-central-1',
      'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1'
    ];
    
    if (config.region && !validRegions.includes(config.region)) {
      errors.push(`Invalid AWS region: ${config.region}`);
    }
    
    return errors;
  }
};