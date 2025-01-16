coverage run --source=app/src -m pytest
coverage report --show-missing
coverage html --title "Anak Tournaments"
