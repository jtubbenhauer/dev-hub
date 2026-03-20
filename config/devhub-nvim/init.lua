-- Intercept and block inotifywait spawns (prevents excessive filesystem watchers)
local uv = vim.loop or vim.uv
local orig_spawn = uv.spawn

uv.spawn = function(cmd, opts, on_exit)
  if cmd == "inotifywait" then
    return {
      is_closing = function()
        return false
      end,
      close = function() end,
      kill = function() end,
    }
  end
  return orig_spawn(cmd, opts, on_exit)
end

require("config")
