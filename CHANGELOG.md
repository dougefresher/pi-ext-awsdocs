# pi-ext-aws-docs

## 1.1.0

### Minor Changes

- e7109a7: aws_docs_search: surface recommended_sections, additional_urls, and response-level metadata (discovered_services, related_tasks, relationships) to match upstream awslabs-mcp parity; document aws-cn tool-scope limitation in README
- e7109a7: aws_docs_read/aws_docs_read_sections: fetch AWS docs' native `.md` mirror directly, falling back to the Python HTML->Markdown helper only when no mirror exists (e.g. Neuron SDK docs); add request timeouts and graceful network-error handling to all fetch calls; aws_docs_read_sections now sends the `sections` query param on its HTML fallback request; Python helper now surfaces `<e>...</e>`-wrapped extraction failures as real errors instead of a false success

## 1.0.1

### Patch Changes

- 7d2d0ba: update dependencies

## 1.0.0

### Major Changes

- 7e5470b: earendil

## 0.1.4

### Patch Changes

- a60f9a1: dep upgrade

## 0.1.3

### Patch Changes

- b307847: migrate to typebox

## 0.1.2

### Patch Changes

- c7f9339: add license to package.json

## 0.1.1

### Patch Changes

- 555959f: init
