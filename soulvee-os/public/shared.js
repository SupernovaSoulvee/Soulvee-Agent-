/*
 * Shared by the browser (window.SoulveeShared) and the server (require):
 * brand voices, platforms, the content-plan schema, time-zone helpers and the prompt builders,
 * so the Content tab and the server's autopilot write posts the same way.
 */
(function (root) {
  const BRANDS = [
    { id: 'smc', name: 'Soulveetainment Media Consults', short: 'SMC', look: 'clean, modern tech look in sky blue and deep blue; professional, trustworthy, Lagos business setting' },
    { id: 'dj', name: 'DJ Soulvee', short: 'DJ Soulvee', look: 'premium Afro-urban nightlife: violet and magenta neon light, club energy, Lagos after dark' },
    { id: 'emporium', name: "Soulvee's Emporium", short: 'Emporium', look: 'premium African lifestyle: gold and teal palette, zodiac motifs, rich fabric textures' },
    { id: 'efr', name: 'EFR', short: 'EFR', look: 'bold emerald and teal palette, energetic and youthful' },
    { id: 'digital', name: 'Digital Products', short: 'Digital', look: 'crisp modern digital-product style with rose and pink gradients' },
  ];
  const brandOf = id => BRANDS.find(b => b.id === id) || BRANDS[0];

  const VOICE = {
    dj: 'You are DJ Soulvee (Supernova Soulvee), an Afro-urban DJ and radio broadcaster on Raypower 100.5FM and Metro 97.7FM. Tone: energetic, premium Afro-fusion, confident, visionary — Lagos-rooted with global crossover appeal.',
    smc: 'You are Soulveetainment Media Consults, a creative and technical media powerhouse doing B2B hospitality-tech and AI-automation consulting from Lagos. Tone: professional, innovative, reliable — clear and persuasive.',
    emporium: "You are Soulvee's Emporium, a premium African lifestyle and zodiac-themed merch brand. Tone: stylish, aspirational, lifestyle-driven.",
  };
  const voiceFor = b => VOICE[b === 'efr' ? 'dj' : b === 'digital' ? 'smc' : b] || VOICE.smc;

  const PLATFORMS = [
    { id: 'instagram', name: 'Instagram', service: 'instagram', limit: 2200, media: 'any', url: 'https://www.instagram.com/' },
    { id: 'tiktok', name: 'TikTok', service: 'tiktok', limit: 4000, media: 'any', url: 'https://www.tiktok.com/upload' },
    { id: 'facebook', name: 'Facebook', service: 'facebook', limit: 63206, media: '', url: 'https://www.facebook.com/' },
    { id: 'linkedin', name: 'LinkedIn', service: 'linkedin', limit: 3000, media: '', url: 'https://www.linkedin.com/feed/' },
    { id: 'x', name: 'X', service: 'twitter', limit: 280, media: '', url: 'https://x.com/compose/post' },
    { id: 'threads', name: 'Threads', service: 'threads', limit: 500, media: '', url: 'https://www.threads.net/' },
    { id: 'youtube', name: 'YouTube Shorts', service: 'youtube', limit: 5000, media: 'video', url: 'https://studio.youtube.com/' },
    { id: 'pinterest', name: 'Pinterest', service: 'pinterest', limit: 500, media: 'any', url: 'https://www.pinterest.com/pin-builder/' },
    { id: 'telegram', name: 'Telegram', service: 'telegram', limit: 4096, media: '', url: 'https://web.telegram.org/' },
    { id: 'reddit', name: 'Reddit', service: 'reddit', limit: 40000, media: '', url: 'https://www.reddit.com/submit' },
    { id: 'whatsapp', name: 'WhatsApp', service: 'whatsapp', limit: 65536, media: '', url: 'https://web.whatsapp.com/' },
  ];
  const platformOf = id => PLATFORMS.find(p => p.id === id) || PLATFORMS[0];
  const FORMATS = ['image', 'carousel', 'reel', 'story', 'text', 'video'];
  const YT_CATEGORY = { dj: '10', efr: '10', emporium: '26', smc: '28', digital: '28' };

  const CONTENT_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['posts'],
    properties: {
      posts: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['title', 'caption', 'hashtags', 'platforms', 'format', 'visual', 'script', 'day', 'time'],
          properties: {
            title: { type: 'string' },
            caption: { type: 'string' },
            hashtags: { type: 'array', items: { type: 'string' } },
            platforms: { type: 'array', items: { type: 'string', enum: PLATFORMS.map(p => p.id) } },
            format: { type: 'string', enum: FORMATS },
            visual: { type: 'string' },
            script: { type: 'string' },
            day: { type: 'integer' },
            time: { type: 'string' },
          },
        },
      },
    },
  };

  const ngn = n => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
  const tagLine = tags => (tags || []).map(t => String(t).trim().replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean).map(t => '#' + t).join(' ');
  const deviceZone = () => (typeof Intl === 'object' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Africa/Lagos';

  /* ---------- time zones (the server runs in UTC; the business runs on Lagos time) ---------- */
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function zoneParts(date, tz) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = {};
    f.formatToParts(date).forEach(x => { p[x.type] = x.value; });
    return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second, weekday: WEEKDAYS.indexOf(p.weekday) };
  }
  function offsetAt(ms, tz) {
    const p = zoneParts(new Date(ms), tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (ms - (ms % 1000));
  }
  // Wall-clock time in `tz` -> the real moment (handles daylight saving with a second pass).
  function zonedToUtc(year, month, day, hour, minute, tz) {
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    const first = guess - offsetAt(guess, tz);
    return new Date(guess - offsetAt(first, tz));
  }
  // `day` days after `now` at "HH:MM" local time in `tz`; pushed a day later if that moment is under 10 minutes away.
  function slot(day, time, tz, now) {
    const from = now || new Date();
    const p = zoneParts(from, tz);
    const m = String(time || '').match(/^(\d{1,2}):(\d{2})/);
    const hour = m ? Math.min(23, +m[1]) : 10;
    const minute = m ? Math.min(59, +m[2]) : 0;
    const at = d => { const base = new Date(Date.UTC(p.year, p.month - 1, p.day + d)); return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, minute, tz); };
    const first = at(day);
    return (first.getTime() < from.getTime() + 10 * 60000 ? at(day + 1) : first).toISOString();
  }
  const longDate = (date, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);

  /* ---------- prompts ---------- */
  // opts: brand, goal, offer {name, pitch, tiers:[{name, price}]}, platforms, count, firstDay, lastDay,
  //       today (Date), tz, learnings (text), recent (titles of recent posts)
  function contentPrompt(opts) {
    const brand = brandOf(opts.brand);
    const platforms = (opts.platforms && opts.platforms.length ? opts.platforms : ['instagram']).map(id => platformOf(id).name);
    const firstDay = opts.firstDay || 0;
    const lastDay = opts.lastDay === undefined ? 13 : opts.lastDay;
    const offer = opts.offer;
    const tiers = offer ? (offer.tiers || []).filter(t => Number(t.price) > 0).map(t => `${t.name} ${ngn(t.price)}`).join(', ') : '';
    const recent = (opts.recent || []).filter(Boolean).slice(0, 15);
    return [
      voiceFor(brand.id),
      `You are also the social media content lead for ${brand.name}. The audience is Lagos-first with global reach; Nigerian English or light Pidgin is welcome where it fits the brand.`,
      `Today is ${longDate(opts.today || new Date(), opts.tz || 'Africa/Lagos')}.`,
      `Goal: ${String(opts.goal || '').trim() || 'grow the audience and bring in paying clients'}.`,
      offer ? `Promote this offer: ${offer.name}. ${offer.pitch || ''}${tiers ? ' Prices: ' + tiers + '.' : ''}` : '',
      `Platforms to cover: ${platforms.join(', ')}.`,
      `Write ${opts.count} distinct posts spread from day ${firstDay} to day ${lastDay} (days from today), across those platforms, with a mix of formats (reels or short videos, carousels, single images, stories, text).`,
      opts.learnings ? `What has worked recently, from the brand's Buffer results. Use it to choose formats, topics, hooks and posting times; don't copy old captions:\n${opts.learnings}` : '',
      recent.length ? `Recent post titles; don't repeat these topics too closely: ${recent.join('; ')}.` : '',
      '- caption: ready to post, starting with a scroll-stopping hook, written in the brand voice, with one clear call to action (DM, link in bio, book, buy). No hashtags inside the caption.',
      '- Any post that includes X must keep caption plus hashtags under 270 characters; Threads under 480. Other captions up to about 150 words.',
      '- Telegram and WhatsApp posts read like a message to people who already follow the brand. Reddit posts need a plain, useful first line (it becomes the title), no hard sell and no hashtags.',
      '- hashtags: 3 to 8 relevant tags without the # sign, mixing broad and Lagos or Nigeria-specific ones (at most 3 if the post includes LinkedIn).',
      '- visual: a short brief a designer or an image tool can follow (subject, setting, colours, any short text overlay in quotes). Avoid identifiable real people\'s faces.',
      '- script: for reels and short videos, 4 to 6 timed beats with on-screen text; otherwise an empty string.',
      `- day: days from today (${firstDay} to ${lastDay}). time: a good local posting time for that platform and audience, as HH:MM in 24-hour time.`,
      "- Never invent prices, dates, venues, guests or client names that aren't given here.",
    ].filter(Boolean).join('\n');
  }

  // Turns one AI post into a content-plan draft.
  function draftFromAi(p, opts) {
    const chosen = (p.platforms || []).filter(id => PLATFORMS.some(x => x.id === id));
    const firstDay = opts.firstDay || 0;
    const lastDay = opts.lastDay === undefined ? 13 : opts.lastDay;
    const day = Math.max(firstDay, Math.min(lastDay, Math.round(Number(p.day) || 0)));
    const format = FORMATS.includes(p.format) ? p.format : '';
    return {
      brand: opts.brand,
      title: String(p.title || '').trim() || 'Post idea',
      text: [String(p.caption || '').trim(), tagLine(p.hashtags)].filter(Boolean).join('\n\n'),
      platforms: chosen.length ? chosen : (opts.platforms && opts.platforms.length ? opts.platforms : ['instagram']),
      format,
      visual: String(p.visual || ''),
      script: String(p.script || ''),
      media: [],
      status: 'draft',
      scheduledAt: slot(day, p.time, opts.tz || deviceZone(), opts.now),
      igType: format === 'story' ? 'story' : format === 'reel' ? 'reel' : '',
      ytCategory: YT_CATEGORY[opts.brand] || '22',
      firstComment: '',
      notes: '',
      aiAssisted: true,
      source: opts.source || null,
    };
  }

  // Tall images for stories, reels, TikTok and Pinterest; square for everything else.
  function imageShape(format, platforms) {
    const tall = ['story', 'reel', 'video'].includes(format) || (platforms || []).some(id => ['tiktok', 'pinterest', 'youtube'].includes(id));
    return tall ? 'portrait' : 'square';
  }

  function imagePrompt(opts) {
    const brand = brandOf(opts.brand);
    return [
      `Create a ${opts.shape === 'portrait' ? 'tall (portrait)' : 'square'} social media image for ${brand.name}.`,
      `Brief: ${String(opts.visual || '').trim()}`,
      `Look and feel: ${brand.look}.`,
      'Make it scroll-stopping, with one clear focal point and a polished, premium finish.',
      'If the brief asks for words on the image, use only those words, spelled exactly, large and legible. Otherwise add no text.',
      "Don't show identifiable real people's faces, real brand logos or watermarks; show scenes, hands, silhouettes, crowds from behind or objects instead.",
    ].join('\n');
  }

  const api = { BRANDS, brandOf, VOICE, voiceFor, PLATFORMS, platformOf, FORMATS, YT_CATEGORY, CONTENT_SCHEMA, ngn, tagLine, deviceZone, zoneParts, zonedToUtc, slot, longDate, contentPrompt, draftFromAi, imageShape, imagePrompt };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SoulveeShared = api;
})(typeof window === 'undefined' ? globalThis : window);
