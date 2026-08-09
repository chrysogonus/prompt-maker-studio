-- Migration: Convert static fields to dynamic fields structure
-- This migration converts the old prompt table structure with individual columns
-- to the new structure with a JSONB fields column

-- Step 1: Add the new fields column
ALTER TABLE prompts ADD COLUMN fields_new JSONB;

-- Step 2: Migrate existing data to the new format
UPDATE prompts
SET fields_new = jsonb_build_array(
    jsonb_build_object('name', 'goal', 'content', goal)
) 
|| CASE WHEN characters IS NOT NULL AND characters != '' 
    THEN jsonb_build_array(jsonb_build_object('name', 'characters', 'content', characters))
    ELSE '[]'::jsonb
END
|| CASE WHEN style IS NOT NULL AND style != '' 
    THEN jsonb_build_array(jsonb_build_object('name', 'style', 'content', style))
    ELSE '[]'::jsonb
END
|| CASE WHEN setting IS NOT NULL AND setting != '' 
    THEN jsonb_build_array(jsonb_build_object('name', 'setting', 'content', setting))
    ELSE '[]'::jsonb
END
|| CASE WHEN details IS NOT NULL AND details != '' 
    THEN jsonb_build_array(jsonb_build_object('name', 'details', 'content', details))
    ELSE '[]'::jsonb
END
|| CASE WHEN extra_details IS NOT NULL AND extra_details != '' 
    THEN jsonb_build_array(jsonb_build_object('name', 'extra_details', 'content', extra_details))
    ELSE '[]'::jsonb
END;

-- Step 3: Drop old columns
ALTER TABLE prompts DROP COLUMN goal;
ALTER TABLE prompts DROP COLUMN characters;
ALTER TABLE prompts DROP COLUMN style;
ALTER TABLE prompts DROP COLUMN setting;
ALTER TABLE prompts DROP COLUMN details;
ALTER TABLE prompts DROP COLUMN extra_details;

-- Step 4: Rename the new column to 'fields'
ALTER TABLE prompts RENAME COLUMN fields_new TO fields;

-- Step 5: Add NOT NULL constraint
ALTER TABLE prompts ALTER COLUMN fields SET NOT NULL;

-- Optional: Add a check constraint to ensure fields is an array
ALTER TABLE prompts ADD CONSTRAINT fields_is_array CHECK (jsonb_typeof(fields) = 'array');
