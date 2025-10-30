#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def main():
    """Run administrative tasks."""
    # CRITICAL: This line MUST run BEFORE any Django code is imported or executed.
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'stationery_management.settings')
    try:
        # Django imports are safe only AFTER settings module is set above
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
