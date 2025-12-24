# 🌩️ CloudFall

**CloudFall** is a browser-based cloud architecture survival game.

You design infrastructure, handle traffic spikes, block attacks, manage costs —
and try not to take production down.

> This is not a tutorial.  
> This is production pressure.

---

## 🎮 Gameplay

- Incoming user & attack traffic every second
- Limited budget & reputation
- Build infrastructure components
- Bad decisions fail **realistically**, not randomly

### Game Over If
- Reputation drops to zero
- Availability stays below SLA

---

## 🧱 MVP Infrastructure Components

- Load Balancer
- Compute Nodes
- Cache
- Database
- Queue
- Web Application Firewall (WAF)

Each component has:
- Capacity
- Latency
- Cost
- Failure modes

---

## 📊 Metrics That Matter

- Availability %
- Latency
- Cost per minute
- Reputation score

---

## 🧠 What This Teaches

- Scaling is not free
- Caches save databases
- Queues absorb pain
- Security has trade-offs
- Overengineering bankrupts
- Underscaling kills trust

---

## 🛠️ Tech Stack

- Vanilla JavaScript (ES6)
- HTML + CSS (Tailwind)
- Canvas / SVG rendering
- No backend required (MVP)

---

## 🚀 How To Run

```bash
git clone https://github.com/yourname/cloudfall
cd cloudfall
open index.html
