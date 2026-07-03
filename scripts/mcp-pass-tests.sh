#!/bin/bash

URL="http://localhost:4000/mcp"

echo "============================================"
echo "MCP PASS TEST SUITE"
echo "============================================"

request() {
  local id="$1"
  local tool="$2"
  local args="$3"

  echo
  echo "[$id] $tool"

  curl -s -X POST "$URL" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":\"$id\",\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}"

  echo
}

request 1  list_allowed_directories '{}'

request 2  create_directory '{"path":"/data/demo"}'

request 3  create_directory '{"path":"/data/demo/subdir"}'

request 4  write_file '{"path":"/data/demo/hello.txt","content":"Hello World"}'

request 5  write_file '{"path":"/data/demo/config.json","content":"{\"status\":\"ok\"}"}'

request 6  write_file '{"path":"/data/demo/readme.md","content":"# Demo"}'

request 7  read_text_file '{"path":"/data/demo/hello.txt"}'

request 8  read_file '{"path":"/data/demo/readme.md"}'

request 9  read_multiple_files '{"paths":["/data/demo/hello.txt","/data/demo/config.json"]}'

request 10 get_file_info '{"path":"/data/demo/hello.txt"}'

request 11 list_directory '{"path":"/data/demo"}'

request 12 list_directory_with_sizes '{"path":"/data/demo","sortBy":"name"}'

request 13 directory_tree '{"path":"/data/demo"}'

request 14 search_files '{"path":"/data","pattern":"**/*.txt"}'

request 15 search_files '{"path":"/data","pattern":"**/*.md"}'

request 16 move_file '{"source":"/data/demo/hello.txt","destination":"/data/demo/hello-renamed.txt"}'

request 17 edit_file '{"path":"/data/demo/hello-renamed.txt","edits":[{"oldText":"Hello","newText":"Hi"}]}'

request 18 read_text_file '{"path":"/data/demo/hello-renamed.txt"}'

request 19 get_file_info '{"path":"/data/demo/hello-renamed.txt"}'

request 20 directory_tree '{"path":"/data"}'

echo
echo "============================================"
echo "PASS TESTS COMPLETE"
echo "============================================"