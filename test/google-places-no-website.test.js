"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  DEFAULT_ENDPOINT,
  DEFAULT_FIELD_MASK,
  buildSearchRequestBody,
  buildSearchText,
  findCompaniesWithoutWebsites,
  formatCompanies,
  hasWebsite,
  normalizeSearchOptions,
  parseLeadArgs
} = require("../lib/google-places-no-website");

describe("google places no-website lead finder", () => {
  it("builds search text from query, positional text, or industry and location", () => {
    assert.equal(buildSearchText({ query: "roofers in Tampa, FL" }), "roofers in Tampa, FL");
    assert.equal(buildSearchText({ _: ["barbers", "in", "Austin"] }), "barbers in Austin");
    assert.equal(
      buildSearchText({ industry: "pressure washing", location: "Port of Spain" }),
      "pressure washing in Port of Spain"
    );
  });

  it("parses CLI flags and validates defaults", () => {
    const args = parseLeadArgs([
      "--industry",
      "villa rental",
      "--location=Tobago",
      "--format",
      "csv",
      "--limit",
      "10"
    ]);
    const options = normalizeSearchOptions(args);

    assert.equal(options.textQuery, "villa rental in Tobago");
    assert.equal(options.format, "csv");
    assert.equal(options.maxResults, 10);
    assert.equal(options.endpoint, DEFAULT_ENDPOINT);
    assert.equal(options.fieldMask, DEFAULT_FIELD_MASK);
  });

  it("passes the Places Text Search body options through", () => {
    const body = buildSearchRequestBody(
      {
        textQuery: "dentists in Miami",
        includedType: "dentist",
        languageCode: "en",
        rankPreference: "RELEVANCE",
        regionCode: "US"
      },
      { pageSize: 5, pageToken: "next-token" }
    );

    assert.deepEqual(body, {
      textQuery: "dentists in Miami",
      pageSize: 5,
      pageToken: "next-token",
      includedType: "dentist",
      languageCode: "en",
      regionCode: "US",
      rankPreference: "RELEVANCE"
    });
  });

  it("filters for open businesses missing websiteUri across paginated responses", async () => {
    const requests = [];
    const responses = [
      {
        places: [
          {
            id: "place-with-site",
            displayName: { text: "Has Site Co" },
            formattedAddress: "1 Main St",
            websiteUri: "https://example.com",
            businessStatus: "OPERATIONAL"
          },
          {
            id: "lead-one",
            displayName: { text: "No Site Co" },
            formattedAddress: "2 Main St",
            internationalPhoneNumber: "+1 555 0100",
            googleMapsUri: "https://maps.example/lead-one",
            businessStatus: "OPERATIONAL"
          },
          {
            id: "closed-lead",
            displayName: { text: "Closed No Site Co" },
            formattedAddress: "3 Main St",
            businessStatus: "CLOSED_PERMANENTLY"
          }
        ],
        nextPageToken: "page-two"
      },
      {
        places: [
          {
            id: "lead-two",
            displayName: { text: "Blank Site Co" },
            formattedAddress: "4 Main St",
            websiteUri: "   ",
            businessStatus: "OPERATIONAL",
            primaryType: "plumber",
            types: ["plumber", "point_of_interest"]
          }
        ]
      }
    ];
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        text: async () => JSON.stringify(responses.shift())
      };
    };

    const result = await findCompaniesWithoutWebsites({
      apiKey: "test-key",
      fetchImpl,
      query: "plumbers in Tampa",
      scanLimit: "10",
      limit: "5"
    });

    assert.deepEqual(result.leads.map((lead) => lead.name), ["No Site Co", "Blank Site Co"]);
    assert.equal(result.leads[0].phone, "+1 555 0100");
    assert.equal(result.leads[1].types, "plumber|point_of_interest");
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, DEFAULT_ENDPOINT);
    assert.equal(requests[0].options.headers["X-Goog-Api-Key"], "test-key");
    assert.equal(requests[0].options.headers["X-Goog-FieldMask"], DEFAULT_FIELD_MASK);
    assert.equal(JSON.parse(requests[1].options.body).pageToken, "page-two");
  });

  it("requires websiteUri in custom field masks", async () => {
    await assert.rejects(
      () =>
        findCompaniesWithoutWebsites({
          apiKey: "test-key",
          fetchImpl: async () => ({ ok: true, text: async () => "{}" }),
          fieldMask: "places.displayName",
          query: "cafes in Miami"
        }),
      /places\.websiteUri/
    );
  });

  it("formats CSV and table output", () => {
    const companies = [
      {
        name: 'Aurum "Clean", LLC',
        phone: "+1 555 0100",
        address: "1 Main St\nSuite 2",
        mapsUrl: "https://maps.example/aurum",
        placeId: "abc",
        businessStatus: "OPERATIONAL",
        primaryType: "cleaning_service",
        types: "cleaning_service"
      }
    ];

    assert.match(formatCompanies(companies, "csv"), /"Aurum ""Clean"", LLC"/);
    assert.match(formatCompanies(companies, "csv"), /"1 Main St\nSuite 2"/);
    assert.match(formatCompanies(companies, "table"), /Aurum "Clean", LLC/);
  });

  it("identifies websiteUri presence using non-empty values", () => {
    assert.equal(hasWebsite({ websiteUri: "https://example.com" }), true);
    assert.equal(hasWebsite({ websiteUri: "" }), false);
    assert.equal(hasWebsite({}), false);
  });
});
