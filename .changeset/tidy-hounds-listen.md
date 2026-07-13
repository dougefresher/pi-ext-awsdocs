---
"pi-ext-aws-docs": minor
---

aws_docs_read/aws_docs_read_sections: fetch AWS docs' native `.md` mirror directly, falling back to the Python HTML->Markdown helper only when no mirror exists (e.g. Neuron SDK docs); add request timeouts and graceful network-error handling to all fetch calls; aws_docs_read_sections now sends the `sections` query param on its HTML fallback request; Python helper now surfaces `<e>...</e>`-wrapped extraction failures as real errors instead of a false success
