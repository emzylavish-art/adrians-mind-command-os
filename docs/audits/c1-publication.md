# C1 source publication identity

The complete implemented source is published as [`d8b89bbe94291cf2d6d5d36236d03ea749988127`](https://github.com/emzylavish-art/adrians-mind-command-os/commit/d8b89bbe94291cf2d6d5d36236d03ea749988127). The actual full-suite, TypeScript, bundle and clean-browser checks ran on local commit `b17e90c5728f7f1a9f303f703fcf073cbdd2175e`.

**Both commits have the exact same complete Git tree:** `05e1aea8e09d6d1ec7b4fec36ab0352d86e3b704`. After publication, the GitHub branch was fetched through normal Git; `git diff --exit-code b17e90c5728f7f1a9f303f703fcf073cbdd2175e d8b89bbe94291cf2d6d5d36236d03ea749988127` returned 0 with no differences. The connected GitHub tools assigned different author/committer metadata because the shell did not have a GitHub push credential. No code or original source-tree bytes changed during publication. The final delivery adds documentation and retained evidence only.

[Machine-readable publication proof](evidence/c1-publication.json) retains the identities. Raw test/browser reports keep their actual tested local revision; their SHA was not silently rewritten.

## Reconstruct the exact tested commit

The [original commit object text](evidence/c1-validated-source.commit.txt) is retained. A clone containing the published source already has its identical tree and parent objects. To verify the local proof identity without changing any branch:

```sh
git hash-object -t commit -w docs/audits/evidence/c1-validated-source.commit.txt
```

The result must be `b17e90c5728f7f1a9f303f703fcf073cbdd2175e`. Then compare its tree with published source `d8b89bbe94291cf2d6d5d36236d03ea749988127`. Creating this local object does not merge, deploy or alter any branch. The final handoff names the actual GitHub delivery head separately.
