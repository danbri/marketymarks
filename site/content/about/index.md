---
title: about
layout: plain.njk
extraStyle: |
  .zebra { display: inline-block; text-decoration: none; margin-top: 2rem; animation: zebra-glitch 20s infinite; position: relative; }
  @keyframes zebra-glitch {
    0%, 9%, 11%, 100% { transform: scale(1) translate(0, 0); filter: none; opacity: 1; }
    9.5% { transform: scale(5) translate(2px, -1px); filter: blur(1px) contrast(2) saturate(0); opacity: .9; }
    10% { transform: scale(4) translate(-3px, 2px) skewX(10deg); filter: blur(.5px) contrast(1.5) hue-rotate(90deg); text-shadow: -2px 0 #f00, 2px 0 #0ff; opacity: .95; }
    10.5% { transform: scale(5) translate(1px, -2px) skewX(-5deg); filter: blur(2px) brightness(1.5); text-shadow: 3px 0 #f0f, -3px 0 #0f0; opacity: .85; }
  }
  .zebra::before { content: ''; position: absolute; inset: -20px; pointer-events: none; opacity: 0; animation: zebra-static 20s infinite;
    background: url("data:image/svg+xml,%3Csvg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='1'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E"); }
  @keyframes zebra-static { 0%, 9%, 11%, 100% { opacity: 0; } 9.5%, 10.5% { opacity: .3; } 10% { opacity: .5; } }
---

<p>A testing zone for structured product data experiments, labs and collaboration.</p>
<a href="/tools/gtinker/" class="zebra" title="🦓">🦓</a>
