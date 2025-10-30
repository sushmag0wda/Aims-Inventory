from django.core.management.base import BaseCommand
from core.models import Student, Enrollment

class Command(BaseCommand):
    help = "Backfill Enrollment records for existing Students using their current Department and Year"

    def handle(self, *args, **options):
        created = 0
        skipped = 0
        for s in Student.objects.select_related('department').all():
            dept = s.department
            if not dept:
                skipped += 1
                continue
            ay = (dept.academic_year or '').strip()
            year = (s.year or '').strip()
            # Ensure one enrollment per (student, department, ay, year)
            obj, was_created = Enrollment.objects.get_or_create(
                student=s,
                department=dept,
                academic_year=ay,
                year=year,
            )
            if was_created:
                created += 1
        self.stdout.write(self.style.SUCCESS(f"Backfill complete. Created: {created}, Skipped: {skipped}"))
