# Task 07 - Source Registry and Content Addressing

## Goal

Create a source registry that snapshots local input files, computes stable digests, stores canonical content in a content-addressed store, and attaches SourceRef objects to a Run.

## Why This Task Exists

Later tasks must prove that generated requirements, specs, tests, UI, and reports came from a specific version of the inputs.

Without content addressing:

- a brief can change after analysis
- an OpenAPI document can drift after code generation
- screenshots and reports cannot prove their input version
- PR reports cannot reliably cite source provenance

## Inputs

- Run ID
- projectRoot from the Run
- file path relative to the project root
- source kind
- optional media type

## Outputs

- SourceRef with digest
- source snapshot metadata
- canonical content file
- updated Run with SourceRef appended

## Non-Goals

- No brief requirement extraction
- No Figma MCP calls
- No OpenAPI parsing
- No URL fetching
- No repository tree snapshot
- No Evidence extraction
- No PR publishing

## Content Addressing

Each source snapshot is stored by canonical digest:

```text
source-snapshots/
└── sha256/
    └── aa/
        └── aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/
            ├── content
            └── metadata.json
```

## Digest Policy

For text-like files:

- rawDigest is computed from raw bytes
- canonicalDigest is computed after:
  - CRLF/CR line endings are normalized to LF
  - Unicode is normalized to NFC

For binary-like files:

- rawDigest and canonicalDigest are the same

SourceRef.digest uses canonicalDigest.

rawDigest is stored in SourceRef.metadata and snapshot metadata.

## Definition Of Done

- File sources can be registered for a Run
- Registered files must be inside projectRoot
- SourceRef digest is stable
- Snapshot content is stored by digest
- Duplicate source registration is idempotent
- MCP tools can register and inspect source snapshots
- Existing Run and Stage tests still pass
