local M = {
  "projekt0n/github-nvim-theme",
  name = "github-theme",
  lazy = false,
  priority = 1000,
  config = function()
    require("github-theme").setup({
      options = {
        hide_nc_statusline = false,
      },
      groups = {
        github_dark_default = {
          CursorLine = { bg = "#272b30" },
          FloatBorder = { fg = "#d9d9d9" },
        },
      },
    })

    vim.cmd("colorscheme github_dark_default")
  end,
}

return M
