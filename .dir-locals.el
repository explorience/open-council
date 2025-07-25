; Ethan's Emacs config
((nil . ((eval . (progn (electric-indent-local-mode 0)
			(setq indent-line-function (lambda () (interactive) (insert "  ")))
                        (set-command (with-file-name "py" "uv run main.py")))))))
