/**
 * Traffic generator for CloudFall simulation
 * Creates realistic traffic patterns with users, bots, and attacks
 */
import { Request } from "./request.js";
import { EVENTS } from "../engine/eventBus.js";

export class TrafficGenerator {
  constructor(eventBus, gameState) {
    this.eventBus = eventBus;
    this.gameState = gameState;
    
    // Traffic generation parameters
    this.baseTrafficRate = 10; // Base requests per second
    this.trafficGrowthRate = 0.02; // 2% growth per tick
    this.attackProbability = 0.05; // 5% chance of attack per tick
    this.botRatio = 0.15; // 15% of traffic is bots
    
    // Traffic patterns
    this.currentTrafficMultiplier = 1.0;
    this.attackInProgress = false;
    this.attackDuration = 0;
    
    this.setupEventHandlers();
  }
  
  /**
   * Set up event handlers
   */
  setupEventHandlers() {
    this.eventBus.on(EVENTS.TRAFFIC_GENERATED, (data) => {
      this.generateTraffic(data.tick);
    });
  }
  
  /**
   * Generate traffic for the current tick
   */
  generateTraffic(tick) {
    const requests = [];
    
    // Calculate current traffic volume
    const trafficVolume = this.calculateTrafficVolume(tick);
    
    // Generate different types of requests
    const userRequests = this.generateUserRequests(trafficVolume);
    const botRequests = this.generateBotRequests(trafficVolume);
    const attackRequests = this.generateAttackRequests(tick);
    
    requests.push(...userRequests, ...botRequests, ...attackRequests);
    
    // Store requests in game state for processing
    this.gameState.currentRequests = requests;
    
    // Update traffic history
    this.updateTrafficHistory(tick, requests);
    
    console.log(`Tick ${tick}: Generated ${requests.length} requests (${userRequests.length} users, ${botRequests.length} bots, ${attackRequests.length} attacks)`);
    
    return requests;
  }
  
  /**
   * Calculate traffic volume based on growth and patterns
   */
  calculateTrafficVolume(tick) {
    // Base growth over time
    const growthMultiplier = Math.pow(1 + this.trafficGrowthRate, tick);
    
    // Add some realistic daily/hourly patterns
    const timePattern = this.getTimePattern(tick);
    
    // Calculate final volume
    const volume = Math.round(this.baseTrafficRate * growthMultiplier * timePattern * this.currentTrafficMultiplier);
    
    return Math.max(1, volume); // Ensure at least 1 request
  }
  
  /**
   * Get time-based traffic pattern (simulates daily/hourly variations)
   */
  getTimePattern(tick) {
    // Simulate a 24-hour cycle over 240 ticks (4 minutes real time)
    const hourOfDay = (tick % 240) / 10; // 0-24 hours
    
    // Peak hours: 9-11 AM and 2-4 PM and 7-9 PM
    const morningPeak = this.getGaussianMultiplier(hourOfDay, 10, 1); // 9-11 AM
    const afternoonPeak = this.getGaussianMultiplier(hourOfDay, 15, 1); // 2-4 PM
    const eveningPeak = this.getGaussianMultiplier(hourOfDay, 20, 1); // 7-9 PM
    
    // Base traffic + peaks
    return 0.3 + (morningPeak + afternoonPeak + eveningPeak) * 0.7;
  }
  
  /**
   * Get Gaussian multiplier for peak hours
   */
  getGaussianMultiplier(x, center, width) {
    return Math.exp(-Math.pow(x - center, 2) / (2 * Math.pow(width, 2)));
  }
  
  /**
   * Generate user requests
   */
  generateUserRequests(totalVolume) {
    const userCount = Math.round(totalVolume * (1 - this.botRatio));
    const requests = [];
    
    for (let i = 0; i < userCount; i++) {
      // Determine source
      const rand = Math.random();
      let source;
      if (rand < 0.6) {
        source = 'organic';
      } else if (rand < 0.85) {
        source = 'campaign';
      } else {
        source = 'referral';
      }
      
      const request = new Request('user', source);
      request.path = this.generatePath('user');
      requests.push(request);
    }
    
    return requests;
  }
  
  /**
   * Generate bot requests
   */
  generateBotRequests(totalVolume) {
    const botCount = Math.round(totalVolume * this.botRatio);
    const requests = [];
    
    for (let i = 0; i < botCount; i++) {
      // Determine bot type
      const rand = Math.random();
      let source;
      if (rand < 0.4) {
        source = 'search_crawler';
      } else if (rand < 0.7) {
        source = 'monitoring';
      } else {
        source = 'scraping';
      }
      
      const request = new Request('bot', source);
      request.path = this.generatePath('bot');
      requests.push(request);
    }
    
    return requests;
  }
  
  /**
   * Generate attack requests
   */
  generateAttackRequests(tick) {
    const requests = [];
    
    // Check if we should start a new attack
    if (!this.attackInProgress && Math.random() < this.attackProbability) {
      this.attackInProgress = true;
      this.attackDuration = Math.floor(Math.random() * 10) + 5; // 5-15 ticks
      console.log(`🚨 Attack started! Duration: ${this.attackDuration} ticks`);
    }
    
    // Generate attack traffic if attack is in progress
    if (this.attackInProgress) {
      const attackVolume = Math.floor(Math.random() * 100) + 50; // 50-150 attack requests
      
      for (let i = 0; i < attackVolume; i++) {
        // Determine attack type
        const rand = Math.random();
        let source;
        if (rand < 0.6) {
          source = 'ddos';
        } else if (rand < 0.8) {
          source = 'brute_force';
        } else {
          source = 'injection';
        }
        
        const request = new Request('attack', source);
        request.path = this.generatePath('attack');
        requests.push(request);
      }
      
      // Decrease attack duration
      this.attackDuration--;
      if (this.attackDuration <= 0) {
        this.attackInProgress = false;
        console.log('🛡️ Attack ended');
      }
    }
    
    return requests;
  }
  
  /**
   * Generate realistic request paths
   */
  generatePath(requestType) {
    const paths = {
      user: [
        '/', '/home', '/products', '/about', '/contact',
        '/login', '/register', '/profile', '/cart', '/checkout'
      ],
      bot: [
        '/', '/robots.txt', '/sitemap.xml', '/api/health',
        '/products', '/about', '/contact'
      ],
      attack: [
        '/admin', '/wp-admin', '/login', '/api/users',
        '/../../etc/passwd', '/api/admin', '/.env',
        '/phpmyadmin', '/admin.php'
      ]
    };
    
    const pathList = paths[requestType] || paths.user;
    return pathList[Math.floor(Math.random() * pathList.length)];
  }
  
  /**
   * Update traffic history for metrics
   */
  updateTrafficHistory(tick, requests) {
    const summary = {
      tick,
      total: requests.length,
      users: requests.filter(r => r.type === 'user').length,
      bots: requests.filter(r => r.type === 'bot').length,
      attacks: requests.filter(r => r.type === 'attack').length,
      timestamp: Date.now()
    };
    
    this.gameState.trafficHistory.push(summary);
    
    // Keep only last 100 ticks of history
    if (this.gameState.trafficHistory.length > 100) {
      this.gameState.trafficHistory.shift();
    }
  }
  
  /**
   * Set traffic parameters for scenarios
   */
  setTrafficParameters(params) {
    if (params.baseTrafficRate !== undefined) {
      this.baseTrafficRate = params.baseTrafficRate;
    }
    if (params.trafficGrowthRate !== undefined) {
      this.trafficGrowthRate = params.trafficGrowthRate;
    }
    if (params.attackProbability !== undefined) {
      this.attackProbability = params.attackProbability;
    }
    if (params.botRatio !== undefined) {
      this.botRatio = params.botRatio;
    }
  }
  
  /**
   * Trigger a traffic spike
   */
  triggerTrafficSpike(multiplier = 5, duration = 10) {
    this.currentTrafficMultiplier = multiplier;
    
    setTimeout(() => {
      this.currentTrafficMultiplier = 1.0;
      console.log('📈 Traffic spike ended');
    }, duration * 1000);
    
    console.log(`📈 Traffic spike triggered: ${multiplier}x for ${duration} seconds`);
  }
  
  /**
   * Get traffic statistics
   */
  getStatistics() {
    const recentHistory = this.gameState.trafficHistory.slice(-10);
    
    if (recentHistory.length === 0) {
      return {
        averageTotal: 0,
        averageUsers: 0,
        averageBots: 0,
        averageAttacks: 0,
        attackInProgress: this.attackInProgress
      };
    }
    
    return {
      averageTotal: recentHistory.reduce((sum, h) => sum + h.total, 0) / recentHistory.length,
      averageUsers: recentHistory.reduce((sum, h) => sum + h.users, 0) / recentHistory.length,
      averageBots: recentHistory.reduce((sum, h) => sum + h.bots, 0) / recentHistory.length,
      averageAttacks: recentHistory.reduce((sum, h) => sum + h.attacks, 0) / recentHistory.length,
      attackInProgress: this.attackInProgress,
      currentMultiplier: this.currentTrafficMultiplier
    };
  }
  
  /**
   * Reset traffic generator
   */
  reset() {
    this.currentTrafficMultiplier = 1.0;
    this.attackInProgress = false;
    this.attackDuration = 0;
  }
}

// Legacy function for backward compatibility
export function generateTraffic(eventBus) {
  // This is kept for backward compatibility but should not be used
  console.warn('generateTraffic function is deprecated. Use TrafficGenerator class instead.');
}
