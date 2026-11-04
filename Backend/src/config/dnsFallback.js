// DNS resilience for MongoDB Atlas on restrictive networks.
//
// A `mongodb+srv` connection resolves DNS through TWO independent paths:
//
//   1. SRV + TXT records -> dns.promises.resolve() -> the c-ares resolver,
//      which is configured process-wide with dns.setServers().
//   2. The TLS socket    -> tls.connect({ host }) -> dns.lookup() ->
//      getaddrinfo (the OS resolver / resolv.conf). This path is NOT
//      affected by dns.setServers() at all.
//
// On some networks (college Wi-Fi, captive portals, mobile hotspots) the OS
// resolver fails to resolve the Atlas hostname and the driver reports
// `getaddrinfo ENOTFOUND ...`. Two complementary protections are installed
// here, both with the SYSTEM resolvers first so working networks behave
// exactly as before:
//
//   - c-ares (path 1): system resolvers first, public resolvers
//     (8.8.8.8 / 1.1.1.1 by default) appended as failover for the case
//     where the system resolver stops answering.
//   - dns.lookup wrapper (path 2): the original getaddrinfo is always tried
//     first; ONLY when it fails with a DNS error does the lookup retry
//     through a fallback resolver whose list puts the PUBLIC resolvers
//     first. That ordering matters: this path only runs after the system
//     resolver already failed for this name, and c-ares does not fail over
//     on an authoritative-looking NXDOMAIN answer - so a network that
//     hijacks/NXDOMAINs Atlas names is rescued by asking public DNS first,
//     while networks that block outbound UDP/53 still fall through to the
//     system resolvers in the same list.
//
// No credentials are involved: DNS servers are public anycast addresses.
// Configure/disable with DNS_FALLBACK_SERVERS (see Backend/.env.example).
const dns = require("dns");

const DEFAULT_FALLBACK_SERVERS = ["8.8.8.8", "1.1.1.1"];

// Bound the rescue path: ~2s per query attempt, one try, so a failed
// lookup never stalls a connection for long. Probed: the constructor
// options are honored by Node's c-ares resolver.
const RESOLVER_OPTIONS = { timeout: 2000, tries: 1 };

// getaddrinfo / c-ares codes that mean "DNS resolution failed" (as opposed
// to a local misuse of the API, which must pass through untouched).
const DNS_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "EAI_NONAME",
  "EAI_ADDRFAMILY",
  "ESERVFAIL",
  "ETIMEOUT",
]);

const isDnsFailure = (error) =>
  Boolean(error && error.code && DNS_ERROR_CODES.has(error.code));

// DNS_FALLBACK_SERVERS: comma-separated IP servers.
//   unset   -> defaults (8.8.8.8, 1.1.1.1)
//   ""      -> no public fallback (system resolvers only, behavior as before)
//   custom  -> your list, e.g. "9.9.9.9,1.0.0.1"
// Entries that are not plausible IP[:port] literals are dropped here so a
// typo can never make dns.setServers() throw; c-ares only accepts IP
// literals anyway (no hostnames).
const SERVER_PATTERN = /^\[?[0-9a-fA-F:.]+\]?(?::\d{1,5})?$/;

const parseFallbackServers = (raw) => {
  if (raw === undefined || raw === null) {
    return [...DEFAULT_FALLBACK_SERVERS];
  }

  return String(raw)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && SERVER_PATTERN.test(entry));
};

// Ordered merge with de-duplication (order matters: first server wins).
const buildDnsServers = (primary, extra) => [
  ...new Set([...primary, ...extra].filter(Boolean)),
];

// Shared fallback resolver for the lookup wrapper: public resolvers first,
// then the system ones (see header note on ordering).
const createResolver = (servers) => {
  let resolver;

  try {
    resolver = new dns.Resolver(RESOLVER_OPTIONS);
  } catch {
    resolver = new dns.Resolver();
  }

  if (servers.length > 0) {
    try {
      resolver.setServers(servers);
    } catch {
      // Malformed list: keep the resolver's own (system) defaults rather
      // than fail - a rescue attempt with system DNS beats no attempt.
    }
  }

  return resolver;
};

// Resolve A/AAAA through the given resolver and return
// [{ address, family }] in IPv4-first order (many campus/hotspot networks
// advertise broken IPv6, so preferring A records is the safe default).
// Never rejects: a failed or empty resolution resolves to [].
const resolveViaResolver = (resolver, hostname, options) =>
  new Promise((resolve) => {
    const numericFamily =
      typeof options === "number" ? options : undefined;
    const family =
      numericFamily ||
      (typeof options === "object" && options !== null && options.family) ||
      0;

    const want4 = family !== 6;
    const want6 = family !== 4;

    const v4 = [];
    const v6 = [];
    let pending = (want4 ? 1 : 0) + (want6 ? 1 : 0);

    if (pending === 0) {
      resolve([]);
      return;
    }

    const finish = () => {
      pending -= 1;
      if (pending === 0) {
        resolve([...v4, ...v6]);
      }
    };

    if (want4) {
      resolver.resolve4(hostname, (error, addresses) => {
        if (!error && Array.isArray(addresses)) {
          for (const address of addresses) {
            v4.push({ address, family: 4 });
          }
        }
        finish();
      });
    }

    if (want6) {
      resolver.resolve6(hostname, (error, addresses) => {
        if (!error && Array.isArray(addresses)) {
          for (const address of addresses) {
            v6.push({ address, family: 6 });
          }
        }
        finish();
      });
    }
  });

// Wrap dns.lookup: identical passthrough behavior, except that a DNS
// failure from the OS resolver is retried through resolveFallback once
// before the original error is surfaced. Injected dependencies keep this
// testable without touching real DNS.
const createLookupWithFallback = (originalLookup, resolveFallback) => {
  const wrapped = (hostname, options, callback) => {
    let opts = options;
    let cb = callback;

    // dns.lookup shorthand: (hostname, callback)
    if (typeof opts === "function") {
      cb = opts;
      opts = {};
    }

    // No callback (invalid usage): behave exactly like the original.
    if (typeof cb !== "function") {
      return originalLookup(hostname, options, callback);
    }

    return originalLookup(hostname, opts, (error, address, family) => {
      // Success or a non-DNS error: pass straight through, byte for byte.
      if (!error || !isDnsFailure(error)) {
        cb(error, address, family);
        return;
      }

      // The system resolver failed for this name - retry through the
      // fallback resolver. Only ever ONE rescue attempt per lookup.
      Promise.resolve()
        .then(() => resolveFallback(hostname, opts))
        .then((records) => {
          if (Array.isArray(records) && records.length > 0) {
            if (typeof opts === "object" && opts !== null && opts.all) {
              cb(null, records);
            } else {
              cb(null, records[0].address, records[0].family);
            }
            return;
          }

          cb(error, address, family);
        })
        .catch(() => {
          cb(error, address, family);
        });
    });
  };

  // Preserve util.promisify(dns.lookup) behavior.
  if (originalLookup && originalLookup.__promisify__) {
    wrapped.__promisify__ = originalLookup.__promisify__;
  }

  return wrapped;
};

// Apply the c-ares server list for SRV/TXT resolution (path 1). System
// resolvers first; the public ones are appended as failover. When no
// fallback servers are configured the existing OS config is left alone.
const applyCaresServers = (dnsImpl, merged, system) => {
  if (merged.length === 0) {
    return;
  }

  try {
    dnsImpl.setServers(merged);
  } catch (error) {
    // A malformed entry must never break DNS entirely: restore the exact
    // system resolvers the OS already uses, then report once.
    try {
      dnsImpl.setServers(system);
    } catch {
      // Leave the current configuration untouched.
    }
    console.error(
      "DNS fallback: custom resolver list not applied:",
      String((error && error.message) || error)
    );
  }
};

// Install both protections. Idempotent: a second call is a no-op, and the
// marker on the function survives even if another module re-required us.
// Returns true when this call performed the installation.
const installDnsFallback = (dnsImpl = dns) => {
  if (dnsImpl.lookup && dnsImpl.lookup.__voltaDnsFallback) {
    return false;
  }

  const system =
    typeof dnsImpl.getServers === "function" ? dnsImpl.getServers() : [];
  const fallbacks = parseFallbackServers(process.env.DNS_FALLBACK_SERVERS);

  // Path 1: SRV/TXT lookups (c-ares). Skipped when the public fallback is
  // disabled - the OS resolver config is left exactly as it is.
  if (fallbacks.length > 0) {
    applyCaresServers(dnsImpl, buildDnsServers(system, fallbacks), system);
  }

  // Path 2: getaddrinfo wrapper with rescue (public resolvers first).
  const rescueResolver = createResolver(buildDnsServers(fallbacks, system));
  const originalLookup = dnsImpl.lookup;
  const wrapped = createLookupWithFallback(originalLookup, (hostname, opts) =>
    resolveViaResolver(rescueResolver, hostname, opts)
  );

  wrapped.__voltaDnsFallback = true;
  dnsImpl.lookup = wrapped;

  return true;
};

module.exports = {
  DEFAULT_FALLBACK_SERVERS,
  parseFallbackServers,
  buildDnsServers,
  isDnsFailure,
  resolveViaResolver,
  createLookupWithFallback,
  installDnsFallback,
};
