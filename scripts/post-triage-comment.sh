#!/usr/bin/env bash
#
# Publica (o actualiza) el comentario de diagnóstico del triage en el issue que
# disparó el workflow.
#
# El cuerpo se pasa SIEMPRE por stdin, nunca como argumento:
#
#   ./scripts/post-triage-comment.sh <<'TRIAGE'
#   ## Diagnóstico automático
#   ...
#   TRIAGE
#
# Es "sticky": busca un comentario previo con el marcador y lo reescribe, así un
# re-triage por edición del issue no apila comentarios nuevos.
#
# El número de issue se lee del payload del evento, no de los argumentos, para
# que el texto de un issue no pueda redirigir el comentario a otro issue.
#

set -euo pipefail

MARKER='<!-- claude-issue-triage -->'
MAX_BYTES=65000 # el límite de GitHub son 65536

if [[ $# -gt 0 ]]; then
  echo "Error: este script no acepta argumentos; el cuerpo va por stdin" >&2
  exit 1
fi

ISSUE=$(jq -r '.issue.number // empty' "${GITHUB_EVENT_PATH:?GITHUB_EVENT_PATH not set}")
if ! [[ "$ISSUE" =~ ^[0-9]+$ ]]; then
  echo "Error: no issue number in event payload" >&2
  exit 1
fi

REPO="${GH_REPO:-${GITHUB_REPOSITORY:-}}"
if [[ -z "$REPO" || "$REPO" != */* || "$REPO" == */*/* ]]; then
  echo "Error: GITHUB_REPOSITORY debe ser owner/repo" >&2
  exit 1
fi

BODY=$(cat)

if [[ -z "${BODY//[[:space:]]/}" ]]; then
  echo "Error: el cuerpo del comentario llegó vacío" >&2
  exit 1
fi

# Red de seguridad contra exfiltración: el cuerpo es un diagnóstico, nunca puede
# contener credenciales. Corta tanto si alguien redirige un archivo de entorno a
# stdin como si el texto del issue logró inyectar un token en el diagnóstico.
if printf '%s' "$BODY" | grep -qE 'gh[psuor]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|ACTIONS_(ID_TOKEN|RUNTIME)_|AWS_SECRET|BEGIN [A-Z ]*PRIVATE KEY'; then
  echo "Error: el cuerpo parece contener credenciales; no se publica" >&2
  exit 1
fi
if [[ -n "${GH_TOKEN:-}" ]] && [[ "$BODY" == *"$GH_TOKEN"* ]]; then
  echo "Error: el cuerpo contiene el token del runner; no se publica" >&2
  exit 1
fi

FULL="${MARKER}"$'\n'"${BODY}"

if (( ${#FULL} > MAX_BYTES )); then
  FULL="${FULL:0:$MAX_BYTES}"$'\n\n_(truncado)_'
fi

EXISTING=$(
  gh api --paginate "repos/${REPO}/issues/${ISSUE}/comments" \
    --jq "[.[] | select(.body != null and (.body | startswith(\"${MARKER}\"))) | .id] | first // empty"
)

if [[ -n "$EXISTING" ]]; then
  jq -n --arg b "$FULL" '{body: $b}' \
    | gh api -X PATCH "repos/${REPO}/issues/comments/${EXISTING}" --input - --jq '.html_url'
  echo "Comentario de triage actualizado (id ${EXISTING})"
else
  jq -n --arg b "$FULL" '{body: $b}' \
    | gh api -X POST "repos/${REPO}/issues/${ISSUE}/comments" --input - --jq '.html_url'
  echo "Comentario de triage creado en el issue #${ISSUE}"
fi
