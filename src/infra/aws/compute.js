/**
 * AWS EC2 Compute implementation
 * Provides burstable performance, auto-scaling, and AWS-specific features
 */
import { BaseService } from '../baseService.js';

export class AWSCompute extends BaseService {
  constructor(config = {}) {
    super(
      config.name || 'AWS-EC2',
      'aws',
      config.capacity || 500, // requests per second
      config.baseCost || 0.05 // $0.05 per minute
    );
    
    // AWS EC2 specific configuration
    this.type = 'compute';
    this.instanceType = config.instanceType || 't3.medium';
    this.instanceFamily = this.parseInstanceFamily(this.instanceType);
    this.availabilityZone = config.availabilityZone || 'us-east-1a';
    this.tenancy = config.tenancy || 'default'; // default, dedicated, host
    
    // Burstable performance configuration (for T-series instances)
    this.isBurstable = this.instanceFamily.startsWith('t');
    this.cpuCredits = {
      initial: this.isBurstable ? 30 : 0, // Initial CPU credits
      current: this.isBurstable ? 30 : 0,
      maximum: this.isBurstable ? 144 : 0, // 24 hours worth
      earnRate: this.isBurstable ? 0.2 : 0, // Credits per minute at baseline
      baseline: this.isBurstable ? 20 : 100 // Baseline CPU utilization %
    };
    
    // Auto Scaling configuration
    this.autoScaling = {
      enabled: config.autoScaling?.enabled || false,
      minInstances: config.autoScaling?.minInstances || 1,
      maxInstances: config.autoScaling?.maxInstances || 10,
      desiredCapacity: config.autoScaling?.desiredCapacity || 1,
      scaleUpThreshold: config.autoScaling?.scaleUpThreshold || 70, // CPU %
      scaleDownThreshold: config.autoScaling?.scaleDownThreshold || 30, // CPU %
      cooldownPeriod: config.autoScaling?.cooldownPeriod || 300 // seconds
    };
    
    // EBS storage configuration
    this.storage = {
      volumeType: config.storage?.volumeType || 'gp3',
      volumeSize: config.storage?.volumeSize || 20, // GB
      iops: config.storage?.iops || 3000,
      throughput: config.storage?.throughput || 125, // MB/s
      encrypted: config.storage?.encrypted || true
    };
    
    // Networking configuration
    this.networking = {
      vpcId: config.networking?.vpcId || null,
      subnetId: config.networking?.subnetId || null,
      securityGroups: config.networking?.securityGroups || [],
      publicIp: config.networking?.publicIp || false,
      enhancedNetworking: config.networking?.enhancedNetworking || true
    };
    
    // AWS-specific performance characteristics
    this.latencyBase = 5; // Base processing latency
    this.latencyMultiplier = 1.2; // Moderate scaling
    this.degradationThreshold = 0.7; // Starts degrading at 70% load
    this.failureThreshold = 1.3; // Can handle 30% overload
    
    // Instance state
    this.instanceState = 'running'; // pending, running, stopping, stopped, terminated
    this.launchTime = Date.now();
    this.currentCpuUtilization = 0;
    this.lastScalingAction = 0;
    
    // Spot instance configuration
    this.spotInstance = config.spotInstance || false;
    this.spotPrice = config.spotPrice || null;
    this.interruptionRisk = this.spotInstance ? 0.05 : 0; // 5% chance per hour for spot
    
    // Reserved instance configuration
    this.reservedInstance = config.reservedInstance || false;
    this.reservationTerm = config.reservationTerm || 12; // months
    
    // Placement group configuration
    this.placementGroup = {
      name: config.placementGroup?.name || null,
      strategy: config.placementGroup?.strategy || 'cluster' // cluster, partition, spread
    };
  }
  
  /**
   * Parse instance family from instance type
   */
  parseInstanceFamily(instanceType) {
    return instanceType.split('.')[0];
  }
  
  /**
   * Process requests with EC2 burstable performance
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
    this.currentCpuUtilization = Math.min(100, loadRatio * 100);
    
    // Update CPU credits for burstable instances
    this.updateCpuCredits(loadRatio);
    
    // Check for spot instance interruption
    if (this.spotInstance && this.checkSpotInterruption()) {
      // All requests dropped due to spot interruption
      return { processed: [], dropped: requests };
    }
    
    // Update health based on load and CPU credits
    this.updateHealth(loadRatio);
    
    // Trigger auto-scaling if enabled
    this.evaluateAutoScaling();
    
    // Process each request
    for (const request of requests) {
      if (this.shouldDropRequest(loadRatio)) {
        dropped.push(request);
        continue;
      }
      
      // Calculate latency with burstable performance
      const latency = this.calculateEC2Latency(loadRatio);
      request.latency += latency;
      totalLatency += latency;
      
      // Mark request as processed by AWS EC2
      request.provider = 'aws';
      request.service = 'ec2';
      request.instanceType = this.instanceType;
      
      processed.push(request);
    }
    
    // Update metrics
    this.updateMetrics(processed.length, dropped.length, totalLatency);
    
    return { processed, dropped };
  }
  
  /**
   * Calculate latency with EC2-specific performance characteristics
   */
  calculateEC2Latency(loadRatio) {
    let latency = this.calculateLatency(loadRatio);
    
    // Burstable instance performance impact
    if (this.isBurstable) {
      if (this.cpuCredits.current <= 0) {
        // No CPU credits - performance limited to baseline
        const baselineRatio = this.cpuCredits.baseline / 100;
        if (loadRatio > baselineRatio) {
          latency *= (1 + (loadRatio - baselineRatio) * 3); // Significant penalty
        }
      } else if (loadRatio > this.cpuCredits.baseline / 100) {
        // Using CPU credits for burst performance
        latency *= 0.8; // 20% better performance when bursting
      }
    }
    
    // Enhanced networking reduces latency
    if (this.networking.enhancedNetworking) {
      latency *= 0.9; // 10% improvement
    }
    
    // Placement group optimization
    if (this.placementGroup.name) {
      switch (this.placementGroup.strategy) {
        case 'cluster':
          latency *= 0.85; // 15% improvement for cluster placement
          break;
        case 'partition':
          latency *= 0.95; // 5% improvement
          break;
        case 'spread':
          latency *= 1.05; // 5% penalty for spread placement
          break;
      }
    }
    
    return Math.round(latency);
  }
  
  /**
   * Update CPU credits for burstable instances
   */
  updateCpuCredits(loadRatio) {
    if (!this.isBurstable) {
      return;
    }
    
    const cpuUtilization = loadRatio * 100;
    const baselineUtilization = this.cpuCredits.baseline;
    
    if (cpuUtilization <= baselineUtilization) {
      // Earning credits at baseline
      this.cpuCredits.current = Math.min(
        this.cpuCredits.maximum,
        this.cpuCredits.current + this.cpuCredits.earnRate
      );
    } else {
      // Consuming credits for burst performance
      const burstUtilization = cpuUtilization - baselineUtilization;
      const creditsConsumed = (burstUtilization / 100) * 60; // Credits per minute
      this.cpuCredits.current = Math.max(0, this.cpuCredits.current - creditsConsumed);
    }
  }
  
  /**
   * Check for spot instance interruption
   */
  checkSpotInterruption() {
    if (!this.spotInstance) {
      return false;
    }
    
    // Simulate spot interruption based on risk
    const hourlyRisk = this.interruptionRisk;
    const minutelyRisk = hourlyRisk / 60;
    
    return Math.random() < minutelyRisk;
  }
  
  /**
   * Evaluate auto-scaling conditions
   */
  evaluateAutoScaling() {
    if (!this.autoScaling.enabled) {
      return;
    }
    
    const now = Date.now();
    const timeSinceLastAction = (now - this.lastScalingAction) / 1000;
    
    // Check cooldown period
    if (timeSinceLastAction < this.autoScaling.cooldownPeriod) {
      return;
    }
    
    const currentCapacity = this.autoScaling.desiredCapacity;
    
    // Scale up condition
    if (this.currentCpuUtilization > this.autoScaling.scaleUpThreshold &&
        currentCapacity < this.autoScaling.maxInstances) {
      this.scaleUp();
      this.lastScalingAction = now;
    }
    // Scale down condition
    else if (this.currentCpuUtilization < this.autoScaling.scaleDownThreshold &&
             currentCapacity > this.autoScaling.minInstances) {
      this.scaleDown();
      this.lastScalingAction = now;
    }
  }
  
  /**
   * Scale up instances
   */
  scaleUp() {
    const newCapacity = Math.min(
      this.autoScaling.maxInstances,
      this.autoScaling.desiredCapacity + 1
    );
    
    if (newCapacity > this.autoScaling.desiredCapacity) {
      this.autoScaling.desiredCapacity = newCapacity;
      this.capacity = this.capacity * (newCapacity / (newCapacity - 1));
      console.log(`EC2 Auto Scaling: Scaled up to ${newCapacity} instances`);
    }
  }
  
  /**
   * Scale down instances
   */
  scaleDown() {
    const newCapacity = Math.max(
      this.autoScaling.minInstances,
      this.autoScaling.desiredCapacity - 1
    );
    
    if (newCapacity < this.autoScaling.desiredCapacity) {
      this.autoScaling.desiredCapacity = newCapacity;
      this.capacity = this.capacity * (newCapacity / (newCapacity + 1));
      console.log(`EC2 Auto Scaling: Scaled down to ${newCapacity} instances`);
    }
  }
  
  /**
   * Update health considering CPU credits
   */
  updateHealth(loadRatio) {
    super.updateHealth(loadRatio);
    
    // Additional health considerations for burstable instances
    if (this.isBurstable && this.cpuCredits.current <= 0 && loadRatio > 0.5) {
      this.health = 'degraded'; // Performance limited without CPU credits
    }
    
    // Spot instance interruption risk
    if (this.spotInstance && this.interruptionRisk > 0.1) {
      this.health = 'degraded'; // High interruption risk
    }
  }
  
  /**
   * Get AWS EC2-specific cost calculation
   */
  getCost() {
    let cost = 0;
    
    // Base instance cost (varies by instance type)
    const instanceCosts = {
      't3.nano': 0.0052 / 60,
      't3.micro': 0.0104 / 60,
      't3.small': 0.0208 / 60,
      't3.medium': 0.0416 / 60,
      't3.large': 0.0832 / 60,
      't3.xlarge': 0.1664 / 60,
      'm5.large': 0.096 / 60,
      'm5.xlarge': 0.192 / 60,
      'c5.large': 0.085 / 60,
      'c5.xlarge': 0.17 / 60
    };
    
    const instanceCost = instanceCosts[this.instanceType] || this.baseCost;
    cost += instanceCost * this.autoScaling.desiredCapacity;
    
    // EBS storage cost
    const storageCostPerGB = {
      'gp2': 0.10 / (30 * 24 * 60), // $0.10 per GB per month
      'gp3': 0.08 / (30 * 24 * 60), // $0.08 per GB per month
      'io1': 0.125 / (30 * 24 * 60), // $0.125 per GB per month
      'io2': 0.125 / (30 * 24 * 60)
    };
    
    const storageCost = (storageCostPerGB[this.storage.volumeType] || 0.08 / (30 * 24 * 60)) * this.storage.volumeSize;
    cost += storageCost * this.autoScaling.desiredCapacity;
    
    // IOPS cost for provisioned IOPS volumes
    if (['io1', 'io2'].includes(this.storage.volumeType)) {
      const iopsCost = (0.065 / (30 * 24 * 60)) * this.storage.iops; // $0.065 per IOPS per month
      cost += iopsCost * this.autoScaling.desiredCapacity;
    }
    
    // Spot instance discount
    if (this.spotInstance) {
      cost *= 0.3; // Typically 70% discount for spot instances
    }
    
    // Reserved instance discount
    if (this.reservedInstance) {
      const discountRate = this.reservationTerm >= 36 ? 0.6 : 0.75; // 40% or 25% discount
      cost *= discountRate;
    }
    
    // Data transfer costs (simplified)
    const dataTransferCost = this.metrics.requestsPerSecond * 0.00001; // $0.00001 per request
    cost += dataTransferCost;
    
    return cost;
  }
  
  /**
   * Get EC2-specific status
   */
  getStatus() {
    const baseStatus = super.getStatus();
    
    return {
      ...baseStatus,
      type: this.type,
      instanceType: this.instanceType,
      instanceFamily: this.instanceFamily,
      instanceState: this.instanceState,
      availabilityZone: this.availabilityZone,
      cpuUtilization: this.currentCpuUtilization,
      cpuCredits: this.isBurstable ? { ...this.cpuCredits } : null,
      autoScaling: { ...this.autoScaling },
      storage: { ...this.storage },
      networking: { ...this.networking },
      spotInstance: this.spotInstance,
      reservedInstance: this.reservedInstance,
      placementGroup: { ...this.placementGroup }
    };
  }
  
  /**
   * Validate EC2 configuration
   */
  validate() {
    const errors = super.validate();
    
    const validInstanceTypes = [
      't3.nano', 't3.micro', 't3.small', 't3.medium', 't3.large', 't3.xlarge',
      'm5.large', 'm5.xlarge', 'c5.large', 'c5.xlarge'
    ];
    
    if (!validInstanceTypes.includes(this.instanceType)) {
      errors.push(`Invalid instance type: ${this.instanceType}`);
    }
    
    if (!['default', 'dedicated', 'host'].includes(this.tenancy)) {
      errors.push('Invalid tenancy - must be default, dedicated, or host');
    }
    
    if (this.autoScaling.minInstances > this.autoScaling.maxInstances) {
      errors.push('Auto scaling min instances cannot exceed max instances');
    }
    
    if (this.storage.volumeSize < 1 || this.storage.volumeSize > 16384) {
      errors.push('EBS volume size must be between 1 and 16384 GB');
    }
    
    if (this.spotInstance && this.reservedInstance) {
      errors.push('Instance cannot be both spot and reserved');
    }
    
    return errors;
  }
}