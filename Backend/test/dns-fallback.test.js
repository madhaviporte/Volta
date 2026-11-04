// DNS resilience + connect retry: the two protections that make MongoDB
// Atlas work on restrictive networks (college Wi-Fi, captive portals,
// mobile hotspots), plus the bounded connect retry loop.
//
// No server process and no real DNS traffic: the lookup wrapper, the
// resolver path and the retry loop are exercised with injected fakes.
// The one test that touches the real `dns` module only swaps it out and
// restores it in a finally block.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const dns = require("dns");

const {
  DEFAULT_FALLBACK_SERVERS,
  parseFallbackServers,
  buildDnsServers,
  isDnsFailure,
  resolveViaResolver,
  createLookupWithFallback,
  installDnsFallback,
} = require("../src/config/dnsFallback");

const {
  attemptConnect,
  isRetryableConnectError,
} = require("../src/config/db");

// ---------- parseFallbackServers ----------

test("parseFallbackServers: unset env uses the Google/Cloudflare defaults", () => {
  assert.deepEqual(parseFallbackServers(undefined), [
    ...DEFAULT_FALLBACK_SERVERS,
  ]);
  assert.deepEqual(parseFallbackServers(null), [...DEFAULT_FALLBACK_SERVERS]);
});

test("parseFallbackServers: blank env disables the public fallback", () => {
  assert.deepEqual(parseFallbackServers(""), []);
  assert.deepEqual(parseFallbackServers("   "), []);
});

test("parseFallbackServers: custom list is trimmed and junk is dropped", () => {
  assert.deepEqual(parseFallbackServers("9.9.9.9, 1.0.0.1"), [
    "9.9.9.9",
    "1.0.0.1",
  ]);
  assert.deepEqual(parseFallbackServers("8.8.8.8, not a server!,1.1.1.1"), [
    "8.8.8.8",
    "1.1.1.1",
  ]);
});

// ---------- buildDnsServers ----------

test("buildDnsServers: keeps system order first, appends extras, dedupes", () => {
  assert.deepEqual(
    buildDnsServers(["192.168.0.1", "8.8.8.8"], ["8.8.8.8", "1.1.1.1"]),
    ["192.168.0.1", "8.8.8.8", "1.1.1.1"]
  );
});

// ---------- isDnsFailure ----------

test("isDnsFailure: only DNS resolution codes trigger the rescue", () => {
  assert.equal(isDnsFailure({ code: "ENOTFOUND" }), true);
  assert.equal(isDnsFailure({ code: "EAI_AGAIN" }), true);
  assert.equal(isDnsFailure({ code: "ETIMEOUT" }), true);
  assert.equal(isDnsFailure({ code: "ECONNREFUSED" }), false);
  assert.equal(isDnsFailure({ code: "EACCES" }), false);
  assert.equal(isDnsFailure(new Error("no code")), false);
  assert.equal(isDnsFailure(undefined), false);
});

// ---------- resolveViaResolver ----------

const fakeResolver = ({ v4, v6 } = {}) => ({
  resolve4: (hostname, cb) =>
    v4 instanceof Error ? cb(v4) : cb(null, v4 || []),
  resolve6: (hostname, cb) =>
    v6 instanceof Error ? cb(v6) : cb(null, v6 || []),
});

test("resolveViaResolver: family 4 queries only A records", async () => {
  const records = await resolveViaResolver(
    fakeResolver({ v4: ["1.2.3.4"], v6: ["::1"] }),
    "example.test",
    { family: 4 }
  );
  assert.deepEqual(records, [{ address: "1.2.3.4", family: 4 }]);
});

test("resolveViaResolver: family 6 queries only AAAA records", async () => {
  const records = await resolveViaResolver(
    fakeResolver({ v4: ["1.2.3.4"], v6: ["::1"] }),
    "example.test",
    { family: 6 }
  );
  assert.deepEqual(records, [{ address: "::1", family: 6 }]);
});

test("resolveViaResolver: family 0 prefers IPv4, falls back to IPv6", async () => {
  const both = await resolveViaResolver(
    fakeResolver({ v4: ["1.2.3.4"], v6: ["::1"] }),
    "example.test",
    {}
  );
  assert.deepEqual(both, [
    { address: "1.2.3.4", family: 4 },
    { address: "::1", family: 6 },
  ]);

  const only6 = await resolveViaResolver(
    fakeResolver({ v6: ["::1"] }),
    "example.test",
    0
  );
  assert.deepEqual(only6, [{ address: "::1", family: 6 }]);
});

test("resolveViaResolver: both families failing resolves to []", async () => {
  const records = await resolveViaResolver(
    fakeResolver({
      v4: new Error("ENOTFOUND"),
      v6: new Error("ENOTFOUND"),
    }),
    "example.test",
    {}
  );
  assert.deepEqual(records, []);
});

// ---------- createLookupWithFallback ----------

const dnsError = () => Object.assign(new Error("getaddrinfo ENOTFOUND x"), { code: "ENOTFOUND" });

// The rescue path delivers its callback in a microtask (real DNS is async
// anyway), so tests that exercise a rescue must let the queue drain first.
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("lookup wrapper: success passes through untouched, no rescue call", () => {
  let rescued = 0;
  const wrapped = createLookupWithFallback(
    (hostname, opts, cb) => cb(null, "93.184.216.34", 4),
    () => {
      rescued += 1;
      return Promise.resolve([]);
    }
  );

  let result;
  wrapped("example.test", {}, (err, address, family) => {
    result = { err, address, family };
  });

  assert.deepEqual(result, { err: null, address: "93.184.216.34", family: 4 });
  assert.equal(rescued, 0);
});

test("lookup wrapper: non-DNS errors pass through without rescue", () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  let rescued = 0;
  const wrapped = createLookupWithFallback(
    (hostname, opts, cb) => cb(refused),
    () => {
      rescued += 1;
      return Promise.resolve([]);
    }
  );

  let result;
  wrapped("example.test", {}, (err) => {
    result = err;
  });

  assert.equal(result, refused);
  assert.equal(rescued, 0);
});

test("lookup wrapper: DNS failure is rescued and returns the fallback address", async () => {
  const original = dnsError();
  const wrapped = createLookupWithFallback(
    (hostname, opts, cb) => cb(original),
    () => Promise.resolve([{ address: "104.16.1.1", family: 4 }])
  );

  let result;
  wrapped("atlas-shard-00-00.example.test", {}, (err, address, family) => {
    result = { err, address, family };
  });
  await flush();

  assert.deepEqual(result, { err: null, address: "104.16.1.1", family: 4 });
});

test("lookup wrapper: all:true receives the full record list", async () => {
  const wrapped = createLookupWithFallback(
    (hostname, opts, cb) => cb(dnsError()),
    () =>
      Promise.resolve([
        { address: "104.16.1.1", family: 4 },
        { address: "2606:4700::1", family: 6 },
      ])
  );

  let result;
  wrapped("example.test", { all: true }, (err, records) => {
    result = { err, records };
  });
  await flush();

  assert.equal(result.err, null);
  assert.deepEqual(result.records, [
    { address: "104.16.1.1", family: 4 },
    { address: "2606:4700::1", family: 6 },
  ]);
});

test("lookup wrapper: empty or failed rescue surfaces the ORIGINAL error", async () => {
  const original = dnsError();
  const empty = createLookupWithFallback(
    (hostname, opts, cb) => cb(original),
    () => Promise.resolve([])
  );
  let result;
  empty("example.test", {}, (err) => {
    result = err;
  });
  await flush();
  assert.equal(result, original);

  const rejected = createLookupWithFallback(
    (hostname, opts, cb) => cb(original),
    () => Promise.reject(new Error("resolver blew up"))
  );
  let result2;
  rejected("example.test", {}, (err) => {
    result2 = err;
  });
  await flush();
  assert.equal(result2, original);
});

test("lookup wrapper: family option and callback shorthand are forwarded", async () => {
  const seen = [];
  const wrapped = createLookupWithFallback(
    (hostname, opts, cb) => cb(dnsError()),
    (hostname, opts) => {
      seen.push(opts);
      return Promise.resolve([{ address: "2001:db8::1", family: 6 }]);
    }
  );

  // (hostname, familyNumber, callback) shorthand
  let byNumber;
  wrapped("example.test", 6, (err, address, family) => {
    byNumber = { err, address, family };
  });
  await flush();
  assert.equal(seen[0], 6);
  assert.deepEqual(byNumber, { err: null, address: "2001:db8::1", family: 6 });

  // (hostname, callback) shorthand still works
  let byShorthand;
  wrapped("example.test", (err, address) => {
    byShorthand = { err, address };
  });
  await flush();
  assert.deepEqual(byShorthand, { err: null, address: "2001:db8::1" });
});

test("lookup wrapper: preserves util.promisify support and the install marker", () => {
  const original = Object.assign((h, o, cb) => cb(null, "1.2.3.4", 4), {
    __promisify__: "sentinel",
  });
  const wrapped = createLookupWithFallback(original, () => Promise.resolve([]));
  assert.equal(wrapped.__promisify__, "sentinel");
});

// ---------- installDnsFallback (real dns module, restored afterwards) ----------

test("installDnsFallback: applies resolver list, is idempotent, restores state", () => {
  const originalLookup = dns.lookup;
  const originalServers = dns.getServers();
  const originalEnv = process.env.DNS_FALLBACK_SERVERS;

  try {
    process.env.DNS_FALLBACK_SERVERS = "9.9.9.9,1.0.0.1";

    assert.equal(installDnsFallback(), true);
    assert.equal(Boolean(dns.lookup.__voltaDnsFallback), true);
    // system resolvers first, custom fallback appended
    assert.deepEqual(dns.getServers(), [
      ...originalServers,
      "9.9.9.9",
      "1.0.0.1",
    ]);

    // second install is a no-op
    const afterFirst = dns.lookup;
    assert.equal(installDnsFallback(), false);
    assert.equal(dns.lookup, afterFirst);
  } finally {
    dns.lookup = originalLookup;
    dns.setServers(originalServers);

    if (originalEnv === undefined) {
      delete process.env.DNS_FALLBACK_SERVERS;
    } else {
      process.env.DNS_FALLBACK_SERVERS = originalEnv;
    }
  }
});

test("installDnsFallback: blank env leaves the c-ares config untouched", () => {
  const originalEnv = process.env.DNS_FALLBACK_SERVERS;
  const setCalls = [];
  const fakeDns = {
    lookup: (hostname, opts, cb) => cb(null, "1.2.3.4", 4),
    getServers: () => ["10.0.0.1"],
    setServers: (servers) => setCalls.push(servers),
  };

  try {
    process.env.DNS_FALLBACK_SERVERS = "";

    assert.equal(installDnsFallback(fakeDns), true);
    assert.deepEqual(setCalls, []); // no public fallback -> no setServers call
    assert.equal(Boolean(fakeDns.lookup.__voltaDnsFallback), true);
    assert.equal(installDnsFallback(fakeDns), false); // idempotent per module
  } finally {
    if (originalEnv === undefined) {
      delete process.env.DNS_FALLBACK_SERVERS;
    } else {
      process.env.DNS_FALLBACK_SERVERS = originalEnv;
    }
  }
});

test("installDnsFallback: a rejected custom list falls back to system servers", () => {
  const originalEnv = process.env.DNS_FALLBACK_SERVERS;
  const setCalls = [];
  const fakeDns = {
    lookup: (hostname, opts, cb) => cb(null, "1.2.3.4", 4),
    getServers: () => ["10.0.0.1"],
    setServers: (servers) => {
      setCalls.push(servers);
      if (servers.length > 1) {
        throw new Error("bad list");
      }
    },
  };

  try {
    process.env.DNS_FALLBACK_SERVERS = "8.8.8.8";

    installDnsFallback(fakeDns);
    assert.deepEqual(setCalls, [
      ["10.0.0.1", "8.8.8.8"], // attempt 1: system + public
      ["10.0.0.1"], // attempt 2: system only (graceful degradation)
    ]);
  } finally {
    if (originalEnv === undefined) {
      delete process.env.DNS_FALLBACK_SERVERS;
    } else {
      process.env.DNS_FALLBACK_SERVERS = originalEnv;
    }
  }
});

// ---------- connect retry / error classification ----------

const transient = (message, code) =>
  Object.assign(new Error(message), { name: "MongooseServerSelectionError", ...(code ? { code } : {}) });

test("isRetryableConnectError: transient network failures are retried", () => {
  // The exact production failure this feature exists for
  assert.equal(
    isRetryableConnectError(
      transient("getaddrinfo ENOTFOUND ac-xyz.mongodb.net")
    ),
    true
  );
  // SRV NXDOMAIN (probe: name Error, code ENOTFOUND)
  assert.equal(
    isRetryableConnectError(
      Object.assign(new Error("querySrv ENOTFOUND _mongodb._tcp.x"), {
        name: "Error",
        code: "ENOTFOUND",
      })
    ),
    true
  );
  assert.equal(
    isRetryableConnectError(transient("connect ECONNREFUSED 127.0.0.1:1")),
    true
  );
  assert.equal(isRetryableConnectError(transient("server selection timed out")), true);
});

test("isRetryableConnectError: configuration errors fail fast", () => {
  assert.equal(
    isRetryableConnectError(
      Object.assign(new Error("Authentication failed."), {
        name: "MongoAuthenticationError",
      })
    ),
    false
  );
  assert.equal(
    isRetryableConnectError(
      Object.assign(new Error("Invalid connection string"), {
        name: "MongoParseError",
      })
    ),
    false
  );
  assert.equal(
    isRetryableConnectError(
      Object.assign(new Error("The `uri` parameter is required."), {
        name: "MongooseError",
      })
    ),
    false
  );
  assert.equal(isRetryableConnectError(null), false);
});

test("attemptConnect: retries transient failures then succeeds", async () => {
  let calls = 0;
  const errors = [];

  const result = await attemptConnect(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw transient(`getaddrinfo ENOTFOUND attempt ${calls}`);
      }
      return "connected";
    },
    {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 1,
      onError: (error, attempt, info) => errors.push({ attempt, ...info }),
    }
  );

  assert.equal(result, "connected");
  assert.equal(calls, 3);
  assert.equal(errors.length, 2);
  assert.deepEqual(
    errors.map((e) => e.willRetry),
    [true, true]
  );
});

test("attemptConnect: permanent errors are NOT retried", async () => {
  let calls = 0;

  await assert.rejects(
    attemptConnect(
      async () => {
        calls += 1;
        throw Object.assign(new Error("Authentication failed."), {
          name: "MongoAuthenticationError",
        });
      },
      { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }
    ),
    /Authentication failed/
  );

  assert.equal(calls, 1);
});

test("attemptConnect: bounded - stops after maxAttempts and throws the last error", async () => {
  let calls = 0;

  await assert.rejects(
    attemptConnect(
      async () => {
        calls += 1;
        throw transient(`getaddrinfo ENOTFOUND call ${calls}`);
      },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 }
    ),
    /call 3/
  );

  assert.equal(calls, 3);
});
