# core/apps.py (UPDATE THIS FILE)

from django.apps import AppConfig

class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        # ❗ CRITICAL FIX: Load the signals file
        import core.signals