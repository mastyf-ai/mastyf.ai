{{/*
Expand the name of the chart.
*/}}
{{- define "mcp-guardian.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "mcp-guardian.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "mcp-guardian.labels" -}}
helm.sh/chart: {{ include "mcp-guardian.name" . }}-{{ .Chart.Version | replace "+" "_" }}
{{ include "mcp-guardian.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "mcp-guardian.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mcp-guardian.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}