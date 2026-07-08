/**
 * OpenAPI 3.0 document for the GitRank API.
 *
 * Authored as a plain object (decoupled from route validation) and served via
 * @fastify/swagger in `static` mode, so it documents both requests and responses
 * without affecting runtime validation or serialization. Keep it in sync with the
 * routes; `npm run docs:gen` writes it to `openapi.json`.
 */

const errorResponse = (description) => ({
  description,
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/Error' } },
  },
});

const jsonBody = (ref) => ({
  required: true,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
});

const jsonResponse = (description, ref) => ({
  description,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
});

const slugParam = {
  name: 'slug',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Cohort slug (kebab-case).',
  example: 'devsoc-2025',
};

export const openapiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'GitRank API',
    version: '0.1.0',
    description:
      'Tracks GitHub activity of members across cohorts, ranks them on leaderboards, ' +
      'and awards titles (records + badges). Every joiner is also auto-added to the ' +
      'always-on `global` cohort, which uses a rolling 365-day window. Reads are ' +
      'public; `/admin/*` routes require a static bearer token.',
  },
  servers: [
    { url: 'https://gitrank-backend.onrender.com', description: 'Production (Render)' },
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  tags: [
    { name: 'System', description: 'Health and service metadata.' },
    { name: 'Cohorts', description: 'Cohort listing, detail, and public self-serve join.' },
    { name: 'Leaderboard', description: 'Ranked members per cohort.' },
    { name: 'Titles', description: 'Records and badges per cohort.' },
    { name: 'Members', description: 'Member profiles.' },
    { name: 'Admin', description: 'Protected admin operations (bearer token required).' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Static admin token from the `ADMIN_TOKEN` env var.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'NOT_FOUND' },
              message: { type: 'string', example: 'Cohort not found: devsoc-2025' },
              details: {
                type: 'array',
                description: 'Present on validation errors.',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          db: { type: 'string', enum: ['up', 'down'], example: 'up' },
          lastSyncAt: { type: 'string', format: 'date-time', nullable: true },
          time: { type: 'string', format: 'date-time' },
        },
      },
      Cohort: {
        type: 'object',
        properties: {
          slug: { type: 'string', example: 'devsoc-2025' },
          name: { type: 'string', example: 'DevSoc Training Program 2025' },
          kind: {
            type: 'string',
            enum: ['PROGRAM', 'GLOBAL'],
            description:
              'PROGRAM cohorts are time-boxed training cohorts. The single GLOBAL cohort ' +
              '(slug `global`) covers every joiner across a rolling 365-day window.',
          },
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time', nullable: true },
          isActive: { type: 'boolean' },
          memberCount: { type: 'integer', description: 'Present on list/detail responses.' },
        },
      },
      CohortList: {
        type: 'object',
        properties: {
          cohorts: { type: 'array', items: { $ref: '#/components/schemas/Cohort' } },
        },
      },
      CohortDetail: {
        type: 'object',
        properties: { cohort: { $ref: '#/components/schemas/Cohort' } },
      },
      MemberPublic: {
        type: 'object',
        properties: {
          githubUsername: { type: 'string', example: 'octocat' },
          displayName: { type: 'string', nullable: true },
          avatarUrl: { type: 'string', nullable: true },
          githubId: { type: 'integer', nullable: true },
        },
      },
      Snapshot: {
        type: 'object',
        nullable: true,
        description: 'Latest stats for a member in a cohort; null if never synced.',
        properties: {
          capturedAt: { type: 'string', format: 'date-time' },
          totalCommits: { type: 'integer' },
          totalContributions: { type: 'integer' },
          totalPRs: { type: 'integer' },
          mergedPRs: { type: 'integer' },
          reviewsGiven: { type: 'integer' },
          issuesOpened: { type: 'integer' },
          followers: { type: 'integer' },
          totalStars: { type: 'integer' },
          repoCount: { type: 'integer' },
          contributedRepoCount: { type: 'integer' },
          languageCount: { type: 'integer' },
          topLanguages: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, bytes: { type: 'integer' } },
            },
          },
          longestStreak: { type: 'integer' },
          currentStreak: { type: 'integer' },
          maxCommitsInOneDay: { type: 'integer' },
          weekendCommitRatio: { type: 'number', format: 'float' },
          nightCommitRatio: { type: 'number', format: 'float', nullable: true },
        },
      },
      LeaderboardEntry: {
        type: 'object',
        properties: {
          rank: { type: 'integer' },
          member: { $ref: '#/components/schemas/MemberPublic' },
          stats: { $ref: '#/components/schemas/Snapshot' },
        },
      },
      Leaderboard: {
        type: 'object',
        properties: {
          cohort: { $ref: '#/components/schemas/Cohort' },
          sort: { type: 'string', enum: ['commits', 'contributions', 'streak', 'stars'] },
          sortField: { type: 'string', example: 'totalCommits' },
          ranking: { type: 'array', items: { $ref: '#/components/schemas/LeaderboardEntry' } },
        },
      },
      AwardValue: {
        type: 'object',
        additionalProperties: true,
        description: 'Title-specific value, e.g. `{ "totalCommits": 480 }`.',
      },
      TitleAwardView: {
        type: 'object',
        properties: {
          member: { $ref: '#/components/schemas/MemberPublic' },
          value: { $ref: '#/components/schemas/AwardValue' },
          awardedAt: { type: 'string', format: 'date-time' },
        },
      },
      RecordTitle: {
        type: 'object',
        properties: {
          key: { type: 'string', example: 'most_commits' },
          name: { type: 'string', example: 'The Machine' },
          description: { type: 'string' },
          flavor: { type: 'string', nullable: true },
          holder: {
            allOf: [{ $ref: '#/components/schemas/TitleAwardView' }],
            nullable: true,
            description: 'Current holder, or null if unclaimed.',
          },
        },
      },
      BadgeTitle: {
        type: 'object',
        properties: {
          key: { type: 'string', example: 'century' },
          name: { type: 'string', example: 'Century' },
          description: { type: 'string' },
          flavor: { type: 'string', nullable: true },
          earnedCount: { type: 'integer' },
          earners: { type: 'array', items: { $ref: '#/components/schemas/TitleAwardView' } },
        },
      },
      CohortTitles: {
        type: 'object',
        properties: {
          cohort: { $ref: '#/components/schemas/Cohort' },
          records: { type: 'array', items: { $ref: '#/components/schemas/RecordTitle' } },
          badges: { type: 'array', items: { $ref: '#/components/schemas/BadgeTitle' } },
        },
      },
      MemberTitle: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['RECORD', 'BADGE'] },
          flavor: { type: 'string', nullable: true },
          cohort: {
            type: 'object',
            properties: { slug: { type: 'string' }, name: { type: 'string' } },
          },
          value: { $ref: '#/components/schemas/AwardValue' },
          awardedAt: { type: 'string', format: 'date-time' },
          revokedAt: { type: 'string', format: 'date-time', nullable: true },
          active: { type: 'boolean' },
        },
      },
      MemberProfile: {
        type: 'object',
        properties: {
          member: {
            type: 'object',
            description:
              'Public member profile. `zid` is deliberately NOT included — it is PII and this ' +
              'endpoint is unauthenticated.',
            properties: {
              githubUsername: { type: 'string' },
              displayName: { type: 'string', nullable: true },
              avatarUrl: { type: 'string', nullable: true },
              githubId: { type: 'integer', nullable: true },
              accountCreatedAt: { type: 'string', format: 'date-time', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
          cohorts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                cohort: { $ref: '#/components/schemas/Cohort' },
                role: { type: 'string', enum: ['PARTICIPANT', 'ORGANISER'] },
                joinedAt: { type: 'string', format: 'date-time' },
                programRepos: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { owner: { type: 'string' }, name: { type: 'string' } },
                  },
                },
                stats: { $ref: '#/components/schemas/Snapshot' },
              },
            },
          },
          titles: {
            type: 'array',
            description: 'Record titles held (including past/revoked), with their cohort.',
            items: { $ref: '#/components/schemas/MemberTitle' },
          },
          badges: {
            type: 'array',
            items: { $ref: '#/components/schemas/MemberTitle' },
          },
        },
      },
      MemberHistory: {
        type: 'object',
        properties: {
          member: { $ref: '#/components/schemas/MemberPublic' },
          cohort: { $ref: '#/components/schemas/Cohort' },
          history: {
            type: 'array',
            description:
              'Downsampled per-UTC-day snapshot rows in oldest-first order. Slim columns ' +
              'only — no calendar or topLanguages.',
            items: {
              type: 'object',
              properties: {
                capturedAt: { type: 'string', format: 'date-time' },
                totalCommits: { type: 'integer' },
                totalContributions: { type: 'integer' },
                mergedPRs: { type: 'integer' },
                totalStars: { type: 'integer' },
                longestStreak: { type: 'integer' },
                currentStreak: { type: 'integer' },
                followers: { type: 'integer' },
              },
            },
          },
        },
      },
      MemberCalendar: {
        type: 'object',
        properties: {
          member: { $ref: '#/components/schemas/MemberPublic' },
          cohort: { $ref: '#/components/schemas/Cohort' },
          capturedAt: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: '`null` when the member has no snapshot yet.',
          },
          calendar: {
            type: 'array',
            description: 'Daily contribution counts from the latest snapshot.',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', example: '2025-06-14' },
                count: { type: 'integer', example: 3 },
              },
            },
          },
        },
      },
      JoinRequest: {
        type: 'object',
        required: ['githubUsername', 'zid'],
        additionalProperties: false,
        description:
          'Strict: only `githubUsername` and `zid` are accepted. Any other field ' +
          '(including `displayName` and `programRepo`, which were removed) is rejected ' +
          'with a VALIDATION_ERROR. `displayName`/`avatarUrl` auto-populate from the ' +
          "verified GitHub profile; program repos are now organiser-managed via " +
          '`PUT /admin/members/{username}/program-repo`.',
        properties: {
          githubUsername: { type: 'string', example: 'octocat', description: 'GitHub login.' },
          zid: {
            type: 'string',
            pattern: '^z\\d{7}$',
            example: 'z1234567',
            description: '"z" followed by exactly 7 digits.',
          },
        },
      },
      ProgramRepoRequest: {
        type: 'object',
        required: ['cohortSlug', 'repo'],
        properties: {
          cohortSlug: { type: 'string', example: 'devsoc-2025' },
          repo: {
            oneOf: [
              { type: 'string', example: 'octocat/project', description: '"owner/name".' },
              {
                type: 'object',
                required: ['owner', 'name'],
                properties: { owner: { type: 'string' }, name: { type: 'string' } },
              },
            ],
          },
        },
      },
      ProgramRepoResult: {
        type: 'object',
        properties: {
          programRepo: {
            type: 'object',
            properties: {
              cohortSlug: { type: 'string' },
              username: { type: 'string' },
              owner: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      },
      ProgramRepoDeleteResult: {
        type: 'object',
        properties: {
          deleted: {
            type: 'integer',
            description: 'Number of ProgramRepo rows removed (0 if none registered).',
          },
        },
      },
      UpdateCohortRequest: {
        type: 'object',
        additionalProperties: false,
        description:
          'Patch a cohort. At least one field must be present. The `global` cohort ' +
          'accepts only `name`; any other field 403s. `kind` is not editable.',
        properties: {
          name: { type: 'string' },
          slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time', nullable: true },
          isActive: { type: 'boolean' },
        },
      },
      UpdateCohortResult: {
        type: 'object',
        properties: {
          cohort: { $ref: '#/components/schemas/Cohort' },
          resyncTriggered: {
            type: 'boolean',
            description:
              'True when startDate/endDate changed — the sync + title evaluation for this ' +
              "cohort is running in the background so existing snapshots don't reflect a stale window.",
          },
        },
      },
      DeleteCohortResult: {
        type: 'object',
        properties: {
          deleted: { type: 'boolean', enum: [true] },
          cohort: {
            type: 'object',
            properties: { slug: { type: 'string' }, name: { type: 'string' } },
          },
          counts: {
            type: 'object',
            properties: {
              memberships: { type: 'integer' },
              snapshots: { type: 'integer' },
              awards: { type: 'integer' },
              titles: {
                type: 'integer',
                description: 'Always 0 — Title definitions are global, not cohort-scoped.',
              },
            },
          },
        },
      },
      CreateCohortRequest: {
        type: 'object',
        required: ['name', 'slug', 'startDate'],
        properties: {
          name: { type: 'string', example: 'DevSoc Training Program 2025' },
          slug: {
            type: 'string',
            pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            example: 'devsoc-2025',
          },
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time', nullable: true },
          isActive: { type: 'boolean', default: true },
        },
      },
      SyncSummary: {
        type: 'object',
        properties: {
          sync: {
            type: 'object',
            properties: {
              cohortId: { type: 'string' },
              cohortSlug: { type: 'string' },
              membersSynced: { type: 'integer' },
              snapshotsCreated: { type: 'integer' },
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { username: { type: 'string' }, error: { type: 'string' } },
                },
              },
            },
          },
          evaluation: {
            type: 'object',
            properties: {
              records: { type: 'integer' },
              badges: { type: 'integer' },
              members: { type: 'integer' },
            },
          },
        },
      },
      DeleteMemberResult: {
        type: 'object',
        properties: {
          deleted: { type: 'string' },
          reevaluatedCohorts: { type: 'integer' },
        },
      },
    },
  },
  paths: {
    '/events': {
      get: {
        tags: ['System'],
        summary: 'Server-Sent Events stream',
        description:
          'Long-lived `text/event-stream` connection. Clients (browsers or ' +
          "`EventSource`) receive named events as soon as data changes. Heartbeat " +
          "comments (`:hb`) are sent every 25 s to keep intermediate proxies from " +
          "closing idle connections.\n\n" +
          '**Events emitted:**\n\n' +
          '| event             | payload |\n' +
          '| ----------------- | ------- |\n' +
          '| `sync.completed`  | `{ cohorts: [{ slug, snapshotsCreated }], finishedAt }` |\n' +
          '| `titles.changed`  | `{ slug, changes }` |\n' +
          '| `cohort.updated`  | `{ slug, previousSlug?, dateChanged }` |\n' +
          '| `cohort.deleted`  | `{ slug }` |\n\n' +
          'OpenAPI has no first-class SSE type — this endpoint is documented for discovery. ' +
          'The response body is a stream, not JSON.',
        responses: {
          200: {
            description: 'The stream is open. Read frames as SSE.',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Reports DB connectivity and the most recent snapshot time.',
        responses: { 200: jsonResponse('Service health', 'Health') },
      },
    },
    '/cohorts': {
      get: {
        tags: ['Cohorts'],
        summary: 'List cohorts',
        responses: { 200: jsonResponse('Cohorts with member counts', 'CohortList') },
      },
    },
    '/cohorts/{slug}': {
      get: {
        tags: ['Cohorts'],
        summary: 'Get cohort detail',
        parameters: [slugParam],
        responses: {
          200: jsonResponse('Cohort detail', 'CohortDetail'),
          404: errorResponse('Unknown slug'),
        },
      },
    },
    '/cohorts/{slug}/leaderboard': {
      get: {
        tags: ['Leaderboard'],
        summary: 'Ranked members',
        parameters: [
          slugParam,
          {
            name: 'sort',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['commits', 'contributions', 'streak', 'stars'],
              default: 'commits',
            },
            description: 'Stat to rank by.',
          },
        ],
        responses: {
          200: jsonResponse('Ranked leaderboard', 'Leaderboard'),
          400: errorResponse('Invalid sort value'),
          404: errorResponse('Unknown slug'),
        },
      },
    },
    '/cohorts/{slug}/titles': {
      get: {
        tags: ['Titles'],
        summary: 'Cohort titles with holders/earners',
        parameters: [slugParam],
        responses: {
          200: jsonResponse('Records and badges', 'CohortTitles'),
          404: errorResponse('Unknown slug'),
        },
      },
    },
    '/cohorts/{slug}/join': {
      post: {
        tags: ['Cohorts'],
        summary: 'Public self-serve join',
        description:
          'Verifies the GitHub user exists and adds them to the cohort. The body is strict — ' +
          'only `{ githubUsername, zid }` is accepted; any unknown field (including the ' +
          'removed `displayName` and `programRepo`) is rejected with a friendly ' +
          '`VALIDATION_ERROR`. `displayName`/`avatarUrl` are auto-populated from the verified ' +
          'GitHub profile (falling back to the login when the profile has no name). Program ' +
          'repos are now organiser-managed — see the admin endpoints. Reuses an existing ' +
          'member on an exact (zid, githubUsername) match; never silently re-links a zid to a ' +
          'different username.',
        parameters: [slugParam],
        requestBody: jsonBody('JoinRequest'),
        responses: {
          201: jsonResponse('Member profile', 'MemberProfile'),
          400: errorResponse('Invalid body (bad zid format or an unexpected field)'),
          403: errorResponse('Cohort is inactive or has ended'),
          404: errorResponse('Unknown slug'),
          409: errorResponse('Duplicate zid/username belonging to a different identity'),
          422: errorResponse('GitHub user not found'),
        },
      },
    },
    '/members/{username}': {
      get: {
        tags: ['Members'],
        summary: 'Member profile',
        description: 'Latest stats per cohort, record titles held (incl. past), and badges.',
        parameters: [
          {
            name: 'username',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'octocat',
          },
        ],
        responses: {
          200: jsonResponse('Member profile', 'MemberProfile'),
          404: errorResponse('Unknown member'),
        },
      },
    },
    '/members/{username}/history': {
      get: {
        tags: ['Members'],
        summary: 'Time-series snapshots for a member in a cohort',
        description:
          'Slim, chart-friendly view — one row per UTC calendar day (the last snapshot ' +
          'captured that day wins), oldest-first, within the last `days` days.',
        parameters: [
          { name: 'username', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'cohort',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'Cohort slug.',
          },
          {
            name: 'days',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 365, default: 90 },
          },
        ],
        responses: {
          200: jsonResponse('Downsampled history', 'MemberHistory'),
          400: errorResponse('Missing/invalid query parameters'),
          404: errorResponse('Unknown member or cohort'),
        },
      },
    },
    '/members/{username}/calendar': {
      get: {
        tags: ['Members'],
        summary: "Latest contribution-calendar for a member in a cohort",
        description:
          "Returns the daily `{date, count}` calendar embedded in the member's most recent " +
          'snapshot for the given cohort. Returns `capturedAt: null` and an empty calendar ' +
          '(200, not 404) when the member has no snapshot yet.',
        parameters: [
          { name: 'username', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'cohort',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'Cohort slug.',
          },
        ],
        responses: {
          200: jsonResponse('Latest calendar', 'MemberCalendar'),
          400: errorResponse('Missing `cohort` query parameter'),
          404: errorResponse('Unknown member or cohort'),
        },
      },
    },
    '/admin/cohorts': {
      post: {
        tags: ['Admin'],
        summary: 'Create a cohort',
        security: [{ bearerAuth: [] }],
        requestBody: jsonBody('CreateCohortRequest'),
        responses: {
          201: jsonResponse('Created cohort', 'CohortDetail'),
          400: errorResponse('Invalid body'),
          401: errorResponse('Missing/invalid admin token'),
          409: errorResponse('Duplicate slug'),
        },
      },
    },
    '/admin/members/{username}': {
      delete: {
        tags: ['Admin'],
        summary: 'Remove a member',
        description:
          'Cascade-deletes memberships, snapshots and awards, then re-evaluates affected ' +
          'cohorts so vacated records transfer to the runner-up.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: jsonResponse('Deletion summary', 'DeleteMemberResult'),
          401: errorResponse('Missing/invalid admin token'),
          404: errorResponse('Unknown member'),
        },
      },
    },
    '/admin/cohorts/{slug}': {
      patch: {
        tags: ['Admin'],
        summary: 'Update a cohort',
        description:
          'Partial update — at least one editable field must be supplied. Date changes ' +
          'trigger a background re-sync + title re-evaluation for that cohort and set ' +
          '`resyncTriggered: true` on the response. The global cohort is protected: only ' +
          '`name` may be changed.',
        security: [{ bearerAuth: [] }],
        parameters: [slugParam],
        requestBody: jsonBody('UpdateCohortRequest'),
        responses: {
          200: jsonResponse('Updated cohort', 'UpdateCohortResult'),
          400: errorResponse('Empty body, invalid dates, or unknown field'),
          401: errorResponse('Missing/invalid admin token'),
          403: errorResponse('Editing a protected field on the global cohort'),
          404: errorResponse('Unknown slug'),
          409: errorResponse('New slug is already taken'),
        },
      },
      delete: {
        tags: ['Admin'],
        summary: 'Delete a cohort',
        description:
          'Cascade-deletes memberships, snapshots, and title awards for this cohort. ' +
          'Members themselves survive (they stay on `global` and any other cohorts). ' +
          'The global cohort cannot be deleted.',
        security: [{ bearerAuth: [] }],
        parameters: [slugParam],
        responses: {
          200: jsonResponse('Delete summary', 'DeleteCohortResult'),
          401: errorResponse('Missing/invalid admin token'),
          403: errorResponse('Cannot delete the global cohort'),
          404: errorResponse('Unknown slug'),
        },
      },
    },
    '/admin/members/{username}/program-repo': {
      put: {
        tags: ['Admin'],
        summary: 'Register a program repo for a membership',
        description:
          'Organiser-managed: attaches a `ProgramRepo` to the member\'s membership in the ' +
          'given cohort. Replace-on-exists — one program repo per membership; any prior ' +
          'entries for that membership are removed. Night Owl and other program-repo-derived ' +
          'stats (e.g. the night-commit ratio) only activate for memberships with a ' +
          'registered repo, so cohorts without organiser-set repos simply cannot win Night Owl.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: jsonBody('ProgramRepoRequest'),
        responses: {
          200: jsonResponse('Registered program repo', 'ProgramRepoResult'),
          400: errorResponse('Invalid body (e.g. bad `repo` format)'),
          401: errorResponse('Missing/invalid admin token'),
          404: errorResponse('Unknown member, cohort, or membership'),
        },
      },
      delete: {
        tags: ['Admin'],
        summary: 'Remove a program repo from a membership',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'username', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'cohortSlug',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'The cohort slug whose membership the program repo belongs to.',
          },
        ],
        responses: {
          200: jsonResponse('Delete summary', 'ProgramRepoDeleteResult'),
          400: errorResponse('Missing `cohortSlug` query parameter'),
          401: errorResponse('Missing/invalid admin token'),
          404: errorResponse('Unknown member, cohort, or membership'),
        },
      },
    },
    '/admin/sync/{slug}': {
      post: {
        tags: ['Admin'],
        summary: 'Trigger a manual sync + title evaluation',
        security: [{ bearerAuth: [] }],
        parameters: [slugParam],
        responses: {
          200: jsonResponse('Sync + evaluation summary', 'SyncSummary'),
          401: errorResponse('Missing/invalid admin token'),
          404: errorResponse('Unknown slug'),
        },
      },
    },
    '/admin/sync-all': {
      post: {
        tags: ['Admin'],
        summary: 'Run the sync + eval runner across every active cohort',
        description:
          'External-cron trigger for free-tier hosts. Runs the same in-process runner ' +
          'as `node-cron` and shares its lock: if a sync is already running, returns ' +
          '`{ "skipped": true }` with 200 instead of double-syncing.',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Runner summary (or `{ skipped: true }` if already running).',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        skipped: { type: 'boolean', enum: [false] },
                        startedAt: { type: 'string', format: 'date-time' },
                        finishedAt: { type: 'string', format: 'date-time' },
                        summaries: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              cohortId: { type: 'string' },
                              cohortSlug: { type: 'string' },
                              membersSynced: { type: 'integer' },
                              snapshotsCreated: { type: 'integer' },
                              errors: { type: 'array', items: { type: 'object' } },
                            },
                          },
                        },
                      },
                    },
                    {
                      type: 'object',
                      properties: { skipped: { type: 'boolean', enum: [true] } },
                    },
                  ],
                },
              },
            },
          },
          401: errorResponse('Missing/invalid admin token'),
        },
      },
    },
  },
};

export default openapiDocument;
